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
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "verifier script not found: $SCRIPT"; exit 1; }

# Build a toJSON(needs)-shaped object mirroring the REAL ci-success `needs:` list
# (all jobs — see ci.yml), so a failure on ANY required gate is exercised, not
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
#   $15 needs-hooks (default false) — hook-tests' OWN ci-gate trigger. Defaults
#      false so every fixture that does not touch .claude/hooks keeps hook-tests'
#      success/skip as a legitimate path-filter skip; set true to exercise the
#      hook-tests anti-tamper arm.
#   $16 test-e2e-journey.result (default success)
#   $17 needs-web (default false) — the journey gate's OWN ci-gate trigger.
#      Defaults false so every fixture that does not touch web keeps the journey
#      gate's success/skip as a legitimate path-filter skip; set true to exercise
#      the test-e2e-journey anti-tamper arm.
#   $18 needs-skills (default false) — skills-lint's OWN ci-gate trigger. Defaults
#      false so every fixture that does not touch .claude/skills keeps skills-lint's
#      success/skip as a legitimate path-filter skip; set true to exercise the
#      skills-lint anti-tamper arm.
#   $19 skills-lint.result (default success)
#   $20 needs-api (default false) — openapi-route-sync's OWN ci-gate trigger.
#      Defaults false so every fixture that does not touch the API surface keeps
#      openapi-route-sync's success/skip as a legitimate path-filter skip; set true
#      to exercise the openapi-route-sync anti-tamper arm.
#   $21 openapi-route-sync.result (default success)
#   $22 actions-pin-check.result (default success) — the SHA-pin guard. Mapped to
#      needs-ci in the anti-tamper map (its job `if:`), so every fixture with
#      needs-ci=true ($1=true) must keep this success or it would (correctly) read
#      as an unwiring; set skipped with $1=true to exercise the pin-check
#      anti-tamper arm. ($1=false leaves the trigger unfired, so any result is a
#      legitimate path-filter skip.)
#   $23 test-e2e-engine-smoke.result (default success) — the WASM engine-smoke
#      gate (#8602). Mapped to needs-web AND needs-engine in the anti-tamper map
#      (the two arms of its job `if:`); set skipped while either trigger is true to
#      exercise its anti-tamper arms.
#   $24 needs-engine (default false) — engine-smoke's OTHER ci-gate trigger.
#      Defaults false so every fixture that does not touch engine/ keeps the
#      engine-smoke gate's success/skip as a legitimate path-filter skip; set true
#      to exercise the engine-smoke anti-tamper arm via the engine surface.
#   $25 design-internal-gate.result (default success) — the design workbench gate
#      (PF-1003): the ONLY per-PR job that runs the @spawnforge/ui unit suite for
#      a packages/ui-only PR. Mapped to needs-design in the anti-tamper map (its
#      job `if:`); set skipped with $26=true to exercise its anti-tamper arm.
#   $26 needs-design (default false) — design-internal-gate's OWN ci-gate trigger.
#      Defaults false so every fixture that does not touch apps/design or
#      packages/ui keeps the design gate's success/skip as a legitimate
#      path-filter skip; set true to exercise the design anti-tamper arm.
mk() {
  local nci="$1" ndeps="$2" ls="$3" lst="$4" qg="${5:-success}" ht="${6:-success}" nagentic="${7:-true}" as="${8:-success}" nonboarding="${9:-true}" tog="${10:-success}" ncodex="${11:-true}" ccg="${12:-success}" nghaw="${13:-true}" glr="${14:-success}" nhooks="${15:-false}" te2ej="${16:-success}" nweb="${17:-false}" nskills="${18:-false}" sl="${19:-success}" napi="${20:-false}" ors="${21:-success}" apc="${22:-success}" te2es="${23:-success}" nengine="${24:-false}" dig="${25:-success}" ndesign="${26:-false}"
  jq -nc \
    --arg nci "$nci" --arg ndeps "$ndeps" --arg ls "$ls" --arg lst "$lst" \
    --arg qg "$qg" --arg ht "$ht" --arg nagentic "$nagentic" --arg as "$as" \
    --arg nonboarding "$nonboarding" --arg tog "$tog" --arg ncodex "$ncodex" --arg ccg "$ccg" \
    --arg nghaw "$nghaw" --arg glr "$glr" --arg nhooks "$nhooks" --arg te2ej "$te2ej" --arg nweb "$nweb" \
    --arg nskills "$nskills" --arg sl "$sl" --arg napi "$napi" --arg ors "$ors" --arg apc "$apc" \
    --arg te2es "$te2es" --arg nengine "$nengine" --arg dig "$dig" --arg ndesign "$ndesign" '
    {
      "ci-gate":              { result: "success", outputs: { "needs-ci": $nci, "needs-deps": $ndeps, "needs-agentic": $nagentic, "needs-onboarding": $nonboarding, "needs-codex": $ncodex, "needs-ghaw": $nghaw, "needs-hooks": $nhooks, "needs-web": $nweb, "needs-engine": $nengine, "needs-skills": $nskills, "needs-api": $napi, "needs-design": $ndesign, "needs-any-code": "true" } },
      "quality-gates":        { result: $qg },
      "command-parity":       { result: "success" },
      "build-nextjs":         { result: "success" },
      "docs-internal-gate":   { result: "success" },
      "design-internal-gate": { result: $dig },
      "hook-tests":           { result: $ht },
      "lockfile-sync":        { result: $ls },
      "lockfile-sync-tests":  { result: $lst },
      "agentic-sync":         { result: $as },
      "taskboard-onboarding-guard": { result: $tog },
      "codex-config-guard":   { result: $ccg },
      "ghaw-lock-sync":       { result: $glr },
      "skills-lint":          { result: $sl },
      "openapi-route-sync":   { result: $ors },
      "actions-pin-check":    { result: $apc },
      "test-e2e-ui":          { result: "success" },
      "test-e2e-journey":     { result: $te2ej },
      "test-e2e-engine-smoke": { result: $te2es }
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
# needs-codex=false, needs-ghaw=false, needs-hooks=false — so ALL SEVEN
# self-defending gates (lockfile-sync, lockfile-sync-tests, agentic-sync,
# taskboard-onboarding-guard, codex-config-guard, ghaw-lock-sync, hook-tests)
# skipping is correct path-filter behaviour and must NOT trip the anti-tamper
# check. This is the clean baseline: a PR that touches none of the guarded
# surfaces. hook-tests is skipped here too (ht=skipped, needs-hooks=false), so the
# all-skip baseline is complete across every self-defending gate.
res="$(run_verify "$(mk false false skipped skipped success skipped false skipped false skipped false skipped false skipped false)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "all seven gates legitimately skipped pass (exit 0)"; else fail "legit skip should exit 0, got $rc"; fi

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
# needs-codex AND needs-ghaw are held FALSE (codex-config-guard / ghaw-lock-sync
# both legit-skip) so neither standalone gate can raise a competing tamper that
# masks a dropped needs-agentic arm — this case must fail PURELY on the agentic map.
res="$(run_verify "$(mk false false skipped skipped success success true success false success false skipped false skipped)")"
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
# needs-codex AND needs-ghaw are held FALSE (codex-config-guard / ghaw-lock-sync
# both legit-skip) so neither standalone gate can raise a competing tamper that
# masks a dropped needs-ci arm — this case must fail PURELY on the needs-ci map.
res="$(run_verify "$(mk true true success skipped success success false success false success false skipped false skipped)")"
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
# needs-codex AND needs-ghaw are held FALSE (codex-config-guard / ghaw-lock-sync
# both legit-skip) so neither standalone gate can raise a competing tamper that
# masks a dropped needs-onboarding arm — this case must fail PURELY on the onboarding map.
res="$(run_verify "$(mk false false skipped skipped success success false success true success false skipped false skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "tests skipped while needs-onboarding=true (others false) fails (exit 1)"; else fail "tamper (tests via onboarding arm) should exit 1, got $rc"; fi
if echo "$out" | grep -q "lockfile-sync-tests"; then pass "the unwired gate is named (onboarding arm)"; else fail "unwired gate not named (onboarding arm)"; fi

# --- 21. ISOLATED onboarding-guard tamper: guard skipped while ONLY -----------
#        needs-onboarding=true → exit 1, naming the guard (mirrors cases 15/16/20 for
#        the onboarding arm). lockfile-sync-tests=success here (it ran because the
#        onboarding arm fired), so the guard skip is the sole tamper — proving the
#        guard's needs-onboarding mapping is independently load-bearing even when
#        no other trigger is set.
# needs-codex AND needs-ghaw are held FALSE (codex-config-guard / ghaw-lock-sync
# both legit-skip) so neither standalone gate can raise a competing tamper that masks
# the onboarding tamper — this case must fail PURELY on the onboarding-guard map,
# matching cases 15/16/20 and the needs-ghaw isolation discipline of case 25. (With
# glr=skipped this is load-bearing: a leftover nghaw=true would let the skipped
# ghaw-lock-sync forge a competing tamper and mask a dropped needs-onboarding map.)
res="$(run_verify "$(mk false false skipped success success success false skipped true skipped false skipped false skipped)")"
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

# --- 29. TAMPER: hook-tests skipped while needs-hooks=true → exit 1 ------------
# hook-tests is a required ci-success gate (it runs the .claude/hooks/ suites,
# INCLUDING this permission gate's own tests). A PR editing .claude/hooks or
# .claude/settings.json sets needs-hooks=true, so the job SHOULD run; an
# `if: false` skip is the same single-line unwiring vector guarded for every
# other self-defending gate. All other gates run+succeed here, so the skipped
# hook-tests job is the SOLE tamper. Final mk arg: needs-hooks=true (ht=skipped).
res="$(run_verify "$(mk true true success success success skipped true success true success true success true success true)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "hook-tests skipped while needs-hooks=true fails (exit 1)"; else fail "tamper (hook-tests) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "hook-tests tamper is flagged as a possible unwiring"; else fail "hook-tests tamper message missing"; fi
if echo "$out" | grep -q "hook-tests ("; then pass "the unwired hook-tests gate is named"; else fail "unwired hook-tests gate not named"; fi

# --- 30. hook-tests legit-skips (needs-hooks=false) → exit 0 ------------------
# A PR that touches no hook/settings surface (needs-hooks=false) legitimately
# skips hook-tests; that must NOT trip the anti-tamper check (proves the new
# needs-hooks arm does not false-positive on every non-hooks PR).
res="$(run_verify "$(mk true true success success success skipped true success true success true success true success false)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "hook-tests legit-skip (needs-hooks=false) passes (exit 0)"; else fail "hook-tests legit skip should exit 0, got $rc"; fi

# --- 31. hook-tests FAILED while triggered → exit 1 (hard-failure path) --------
res="$(run_verify "$(mk true true success success success failure true success true success true success true success true)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "hook-tests failure fails (exit 1)"; else fail "hook-tests failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "hook-tests"; then pass "the failing hook-tests gate is named"; else fail "failing hook-tests gate not named"; fi

# --- 32. TAMPER: test-e2e-journey skipped while needs-web=true → exit 1 ---------
# The strict interactive-journey gate is self-defending: it is the only runtime
# proof that the E2E store-exposure flag (NEXT_PUBLIC_E2E_HOOKS) gates correctly
# on a real prod build, and the required proof that the core new-user journey
# stays winnable + exportable. A web-touching PR sets needs-web=true, so the gate
# SHOULD run; an `if: false` skip is the same single-line unwiring vector guarded
# for every other self-defending gate. All other gates run+succeed here (final mk
# args: te2ej=skipped, nweb=true), so the skipped journey gate is the SOLE tamper.
res="$(run_verify "$(mk true true success success success success true success true success true success true success false skipped true)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "journey gate skipped while needs-web=true fails (exit 1)"; else fail "tamper (journey) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "journey tamper is flagged as a possible unwiring"; else fail "journey tamper message missing"; fi
if echo "$out" | grep -q "test-e2e-journey ("; then pass "the unwired journey gate is named"; else fail "unwired journey gate not named"; fi

# --- 33. journey gate legit-skips (needs-web=false) → exit 0 -------------------
# A PR that touches no web surface (needs-web=false) legitimately skips the
# journey gate; that must NOT trip the anti-tamper check (proves the new needs-web
# arm does not false-positive on every non-web PR).
res="$(run_verify "$(mk true true success success success success true success true success true success true success false skipped false)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "journey gate legit-skip (needs-web=false) passes (exit 0)"; else fail "journey legit skip should exit 0, got $rc"; fi

# --- 34. journey gate FAILED while triggered → exit 1 (hard-failure path) -------
res="$(run_verify "$(mk true true success success success success true success true success true success true success false failure true)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "journey gate failure fails (exit 1)"; else fail "journey failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "test-e2e-journey"; then pass "the failing journey gate is named"; else fail "failing journey gate not named"; fi

# --- 35. TAMPER: skills-lint skipped while needs-skills=true → exit 1 ----------
# skills-lint is self-defending: a PR editing .claude/skills/** sets
# needs-skills=true, so the lint job SHOULD run; an `if: false` skip is the same
# single-line unwiring vector guarded for every other self-defending gate. All
# other gates run+succeed here (final mk args: needs-skills=true, sl=skipped), so
# the skipped skills-lint job is the SOLE tamper.
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false true skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "skills-lint skipped while needs-skills=true fails (exit 1)"; else fail "tamper (skills-lint) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "skills-lint tamper is flagged as a possible unwiring"; else fail "skills-lint tamper message missing"; fi
if echo "$out" | grep -q "skills-lint ("; then pass "the unwired skills-lint gate is named"; else fail "unwired skills-lint gate not named"; fi

# --- 36. skills-lint legit-skips (needs-skills=false) → exit 0 -----------------
# A PR that touches no .claude/skills surface (needs-skills=false) legitimately
# skips skills-lint; that must NOT trip the anti-tamper check (proves the
# needs-skills arm does not false-positive on every non-skills PR).
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false false skipped)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "skills-lint legit-skip (needs-skills=false) passes (exit 0)"; else fail "skills-lint legit skip should exit 0, got $rc"; fi

# --- 37. skills-lint FAILED while triggered → exit 1 (hard-failure path) -------
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false true failure)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "skills-lint failure fails (exit 1)"; else fail "skills-lint failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "skills-lint"; then pass "the failing skills-lint gate is named"; else fail "failing skills-lint gate not named"; fi

# --- 38. TAMPER: openapi-route-sync skipped while needs-api=true → exit 1 ------
# openapi-route-sync is self-defending: a PR touching the API surface (a route.ts,
# the spec, or the allowlist) sets needs-api=true, so the gate SHOULD run; an
# `if: false` skip is the same single-line unwiring vector. All other gates
# run+succeed here (final mk args: needs-api=true, ors=skipped), so the skipped
# openapi-route-sync job is the SOLE tamper.
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false false success true skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "openapi-route-sync skipped while needs-api=true fails (exit 1)"; else fail "tamper (openapi) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "openapi tamper is flagged as a possible unwiring"; else fail "openapi tamper message missing"; fi
if echo "$out" | grep -q "openapi-route-sync ("; then pass "the unwired openapi-route-sync gate is named"; else fail "unwired openapi gate not named"; fi

# --- 39. openapi-route-sync legit-skips (needs-api=false) → exit 0 -------------
# A PR that touches no API surface (needs-api=false) legitimately skips
# openapi-route-sync; that must NOT trip the anti-tamper check.
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false false success false skipped)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "openapi-route-sync legit-skip (needs-api=false) passes (exit 0)"; else fail "openapi legit skip should exit 0, got $rc"; fi

# --- 40. openapi-route-sync FAILED while triggered → exit 1 (hard-failure path) -
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false false success true failure)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "openapi-route-sync failure fails (exit 1)"; else fail "openapi failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "openapi-route-sync"; then pass "the failing openapi-route-sync gate is named"; else fail "failing openapi gate not named"; fi
# --- 41. TAMPER: actions-pin-check skipped while needs-ci=true → exit 1 ---------
# The Actions SHA-pin guard is self-defending: a PR editing any .github/workflows
# file or scripts/ sets needs-ci=true, so the guard SHOULD run; an `if: false`
# skip is the same single-line unwiring vector guarded for every other gate —
# and exactly the gap the ux reviewer flagged when the guard lived in a standalone
# workflow outside the required CI Success aggregate. lockfile-sync-tests runs too
# (needs-ci fires it) and succeeds, so the skipped pin-check is the SOLE tamper.
# Final mk arg (22nd): actions-pin-check=skipped, with needs-ci=true ($1).
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false false success false success skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "pin-check skipped while needs-ci=true fails (exit 1)"; else fail "tamper (pin-check) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "pin-check tamper is flagged as a possible unwiring"; else fail "pin-check tamper message missing"; fi
if echo "$out" | grep -q "actions-pin-check ("; then pass "the unwired pin-check gate is named"; else fail "unwired pin-check gate not named"; fi

# --- 42. pin-check legit-skips (needs-ci=false) → exit 0 ----------------------
# A PR touching no workflow/scripts surface (needs-ci=false) legitimately skips the
# pin-check; that must NOT trip the anti-tamper check. ALL other triggers are held
# false here (their gates legit-skip) so the only thing under test is the pin-check
# needs-ci arm not false-positiving on a non-CI PR.
res="$(run_verify "$(mk false false skipped skipped success success false skipped false skipped false skipped false skipped false success false false skipped false skipped skipped)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "pin-check legit-skip (needs-ci=false) passes (exit 0)"; else fail "pin-check legit skip should exit 0, got $rc"; fi

# --- 43. pin-check FAILED while triggered → exit 1 (hard-failure path) ----------
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false false success false success failure)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "pin-check failure fails (exit 1)"; else fail "pin-check failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "actions-pin-check"; then pass "the failing pin-check gate is named"; else fail "failing pin-check gate not named"; fi

# --- 44. TAMPER: test-e2e-engine-smoke skipped while needs-web=true → exit 1 ----
# The engine-smoke gate (#8602) is self-defending: it is the ONLY per-PR job that
# boots the real WASM engine (load -> spawn -> play -> export under SwiftShader
# software WebGL2), closing the F10 gap. A web-touching PR sets needs-web=true, so
# the gate SHOULD run; an `if: false` skip is the same single-line unwiring vector
# guarded for every other self-defending gate. All other gates run+succeed here
# (te2es=skipped at $23, nweb=true at $17, nengine=false at $24), so the skipped
# engine-smoke job is the SOLE tamper.
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success true false success false success success skipped false)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "engine-smoke skipped while needs-web=true fails (exit 1)"; else fail "tamper (engine-smoke via web arm) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "engine-smoke tamper is flagged as a possible unwiring"; else fail "engine-smoke tamper message missing"; fi
if echo "$out" | grep -q "test-e2e-engine-smoke ("; then pass "the unwired engine-smoke gate is named (web arm)"; else fail "unwired engine-smoke gate not named (web arm)"; fi

# --- 45. TAMPER via the needs-engine arm in ISOLATION: engine-smoke skipped -----
#        while ONLY needs-engine=true (needs-web=false, all other triggers false)
#        → exit 1, naming the engine-smoke job.
# The engine-smoke gate fires on `needs-web || needs-engine`: an engine-ONLY PR
# (rendering/ECS change, needs-web=false, needs-engine=true) that slips
# `if: false` onto it would skip it while needs-web is false — the EXACT regression
# class F10 calls out (engine-only PRs ran ZERO e2e). So the needs-engine arm must
# be independently load-bearing. Every other trigger is held false and its gate
# legit-skips, so engine-smoke is the SOLE tamper.
res="$(run_verify "$(mk false false skipped skipped success skipped false skipped false skipped false skipped false skipped false skipped false false skipped false skipped skipped skipped true)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "engine-smoke skipped while ONLY needs-engine=true fails (exit 1)"; else fail "tamper (engine-smoke via engine arm) should exit 1, got $rc"; fi
if echo "$out" | grep -q "test-e2e-engine-smoke ("; then pass "the unwired engine-smoke gate is named (engine arm)"; else fail "unwired engine-smoke gate not named (engine arm)"; fi

# --- 46. engine-smoke legit-skips (needs-web=false AND needs-engine=false) → 0 --
# A PR that touches neither web nor engine legitimately skips engine-smoke; that
# must NOT trip the anti-tamper check (proves neither needs-web nor needs-engine
# arm false-positives on an unrelated PR).
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false false success false success success skipped false)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "engine-smoke legit-skip (web+engine false) passes (exit 0)"; else fail "engine-smoke legit skip should exit 0, got $rc"; fi

# --- 47. engine-smoke FAILED while triggered → exit 1 (hard-failure path) -------
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success true false success false success success failure false)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "engine-smoke failure fails (exit 1)"; else fail "engine-smoke failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "test-e2e-engine-smoke"; then pass "the failing engine-smoke gate is named"; else fail "failing engine-smoke gate not named"; fi

# --- 48. TAMPER: design-internal-gate skipped while needs-design=true → exit 1 --
# The design gate (PF-1003) is the ONLY per-PR job that runs the @spawnforge/ui
# unit suite for a packages/ui-only PR — quality-gates' test-web runs that suite
# only when web/ci changed, so a UI-only PR relies entirely on this gate. A PR
# touching packages/ui sets needs-design=true, so the gate SHOULD run; an
# `if: false` skip is the same single-line unwiring vector guarded for every
# other self-defending gate. All other gates run+succeed here (dig=skipped at
# $25, ndesign=true at $26), so the skipped design job is the SOLE tamper.
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false false success false success success success false skipped true)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "design-internal-gate skipped while needs-design=true fails (exit 1)"; else fail "tamper (design-internal-gate) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "design-internal-gate tamper is flagged as a possible unwiring"; else fail "design-internal-gate tamper message missing"; fi
if echo "$out" | grep -q "design-internal-gate ("; then pass "the unwired design-internal-gate is named"; else fail "unwired design-internal-gate not named"; fi

# --- 49. design-internal-gate legit-skips (needs-design=false) → exit 0 ---------
# A PR that touches neither apps/design nor packages/ui legitimately skips the
# design gate; that must NOT trip the anti-tamper check (proves the needs-design
# arm does not false-positive on an unrelated PR).
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false false success false success success success false skipped false)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "design-internal-gate legit-skip (needs-design=false) passes (exit 0)"; else fail "design-internal-gate legit skip should exit 0, got $rc"; fi

# --- 50. design-internal-gate FAILED while triggered → exit 1 (hard-failure path)
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false false success false success success success false failure true)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "design-internal-gate failure fails (exit 1)"; else fail "design-internal-gate failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "design-internal-gate"; then pass "the failing design-internal-gate is named"; else fail "failing design-internal-gate not named"; fi

# --- 51. CONFIG DRIFT: mapped trigger output ABSENT from ci-gate outputs → 1 ----
# `.outputs[$t] // empty` reads a RENAMED/REMOVED ci-gate output as "did not
# fire" — a rename of `design` in ci-gate's filter block (or of the `needs-design`
# output line) would silently disarm the design gate's anti-tamper arm while
# every fixture above stays green, because the fixtures always carry every key.
# A mapped trigger the workflow no longer emits is config drift, not a
# legitimate skip: the verifier must refuse to certify. dig=skipped so the ONLY
# reason to exit non-zero is the missing key itself (before the fail-closed
# guard, this exact input exited 0).
needs="$(mk true true success success success success true success true success true success true success false success false false success false success success success false skipped false | jq -c 'del(."ci-gate".outputs."needs-design")')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "absent mapped trigger output fails closed (exit 1)"; else fail "absent needs-design output should exit 1 (config drift), got $rc"; fi
if echo "$out" | grep -q "missing from ci-gate outputs"; then pass "config drift names the missing-output condition"; else fail "config-drift message missing"; fi
if echo "$out" | grep -q "needs-design"; then pass "config drift names the missing trigger (needs-design)"; else fail "missing trigger not named"; fi

# --- 52. design-internal-gate ran + succeeded while triggered → exit 0 ----------
# The green path for a packages/ui PR: needs-design=true and the gate ran to
# success. Pins that the anti-tamper arm does not false-positive on the normal
# triggered-and-passed outcome.
res="$(run_verify "$(mk true true success success success success true success true success true success true success false success false false success false success success success false success true)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "design-internal-gate success while triggered passes (exit 0)"; else fail "triggered+success design gate should exit 0, got $rc"; fi
if echo "$out" | grep -q "All required gates passed"; then pass "green path prints the all-passed line"; else fail "all-passed line missing"; fi

# --- 53. design-internal-gate job ABSENT from needs while triggered → exit 1 ----
# Deleting the job from ci-success's `needs:` list is the other one-line
# unwiring (the gate stops reporting at all). `.result // "absent"` must read
# that as absent ≠ success → tamper. Pins the existing fail-closed behavior so
# a refactor cannot regress it to fail-open.
needs="$(mk true true success success success success true success true success true success true success false success false false success false success success success false success true | jq -c 'del(."design-internal-gate")')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "design-internal-gate absent from needs while triggered fails (exit 1)"; else fail "absent design gate should exit 1, got $rc"; fi
if echo "$out" | grep -q "design-internal-gate ("; then pass "the absent design gate is named"; else fail "absent design gate not named"; fi
if echo "$out" | grep -q "result=absent"; then pass "the absent design gate reports result=absent"; else fail "result=absent missing"; fi

# --- Structural: the REAL workflow wiring (not hermetic fixtures) ---------------
# The hermetic cases above prove this verifier's decision logic against synthetic
# NEEDS_JSON; none of them can catch a PR that reworks the real wiring the logic
# certifies — swapping the design gate's test step for a no-op, slipping a
# `continue-on-error` onto it, or detaching its `if:` from needs-design would
# pass every fixture while shipping a dead gate. Pin the load-bearing bytes of
# ci.yml / quality-gates.yml here (same pattern as check-native-bindings.test.sh).
echo ""
echo "--- structural assertions against the real workflow files ---"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
QG_YML="$REPO_ROOT/.github/workflows/quality-gates.yml"
# The invocation is INTENTIONALLY byte-identical in both workflows: ci.yml's
# design-internal-gate is the only per-PR run of the UI suite for a
# packages/ui-only PR, while quality-gates' test-web covers web/ci PRs. Pinning
# the two identical means a future change (flags, reporter, path) must touch
# both or fail here — the lockstep guard the intentional duplication needs.
UI_TEST_CMD='cd packages/ui && npx --no-install vitest run'
if [ -f "$CI_YML" ] && [ -f "$QG_YML" ]; then
  dig_block="$(awk -v j="  design-internal-gate:" '$0==j{f=1} f{print} f && /^  [a-z][a-z0-9-]*:[[:space:]]*$/ && $0!=j{exit}' "$CI_YML")"
  if [ -n "$dig_block" ]; then
    pass "ci.yml has a design-internal-gate job"
  else
    fail "ci.yml is missing the design-internal-gate job"
  fi
  if grep -v '^[[:space:]]*#' <<<"$dig_block" | grep -qF "$UI_TEST_CMD"; then
    pass "design-internal-gate runs the UI suite ('$UI_TEST_CMD')"
  else
    fail "design-internal-gate does not run '$UI_TEST_CMD' (un-commented)"
  fi
  if grep -v '^[[:space:]]*#' <<<"$dig_block" | grep -q 'continue-on-error'; then
    fail "design-internal-gate must not carry continue-on-error (would shadow a red suite)"
  else
    pass "design-internal-gate has no continue-on-error"
  fi
  if grep -v '^[[:space:]]*#' <<<"$dig_block" | grep -qF "needs.ci-gate.outputs.needs-design == 'true'"; then
    pass "design-internal-gate is gated on needs-design"
  else
    fail "design-internal-gate's if: no longer names needs-design"
  fi
  # Whole-file asserts count matches with `grep -c` (reads to EOF) instead of
  # `grep -q`: under `set -o pipefail`, -q's first-match exit SIGPIPEs the
  # upstream grep mid-file (rc 141) → the pipeline false-FAILs on a real match.
  # The <<<"$dig_block" asserts above are immune — a single job block always
  # fits the pipe buffer, so the upstream finishes writing before -q exits.
  if [ "$(grep -v '^[[:space:]]*#' "$SCRIPT" | grep -Ec 'check_triggered "design-internal-gate"[[:space:]]+"needs-design"')" -ge 1 ]; then
    pass "verifier anti-tamper map covers design-internal-gate <-> needs-design"
  else
    fail "verifier anti-tamper map lost its design-internal-gate/needs-design entry"
  fi
  if [ "$(grep -v '^[[:space:]]*#' "$QG_YML" | grep -cF "$UI_TEST_CMD")" -ge 1 ]; then
    pass "quality-gates test-web runs the byte-identical UI suite invocation"
  else
    fail "quality-gates.yml UI suite invocation drifted from ci.yml's ('$UI_TEST_CMD')"
  fi
else
  fail "workflow files not found at $CI_YML / $QG_YML — structural assertions cannot run"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
