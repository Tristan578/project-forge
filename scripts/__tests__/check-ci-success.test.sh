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
#
# `needs-mcp`, `needs-docs` and `needs-any-code` are hardcoded in the object below
# rather than parameterised — they are constant for essentially every fixture, and
# mk's positional list is already 26 long. Flip them with a jq post-filter (see the
# docs-internal-gate and quality-gates cases) instead of adding a 27th arg.
# `command-parity`, `build-nextjs` and `test-e2e-ui` are hardcoded to success for
# the same reason and overridden with jq in the #9437 cases at the end.
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
      "ci-gate":              { result: "success", outputs: { "needs-ci": $nci, "needs-deps": $ndeps, "needs-agentic": $nagentic, "needs-onboarding": $nonboarding, "needs-codex": $ncodex, "needs-ghaw": $nghaw, "needs-hooks": $nhooks, "needs-web": $nweb, "needs-engine": $nengine, "needs-skills": $nskills, "needs-api": $napi, "needs-design": $ndesign, "needs-docs": "false", "needs-mcp": "false", "needs-any-code": "true" } },
      "quality-gates":        { result: $qg },
      "command-parity":       { result: "success" },
      "build-nextjs":         { result: "success" },
      "docs-internal-gate":   { result: "success" },
      "design-internal-gate": { result: $dig },
      "hook-tests":           { result: $ht },
      "hook-tests-windows":   { result: "success" },
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

# --- 31b. TAMPER: hook-tests-windows skipped while needs-ci=true → exit 1 ------
# The Windows leg (#9611) is gated on needs-hooks OR needs-ci, so a PR that
# touches scripts/ (needs-ci=true) must run it; a skipped result there is the
# same single-line unwiring vector. The fixture models it as success everywhere
# else, so this case is the ONLY one exercising its anti-tamper arm.
res="$(run_verify "$(mk true true success success | jq -c '."hook-tests-windows".result = "skipped"')")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "hook-tests-windows skipped while needs-ci=true fails (exit 1)"; else fail "tamper (hook-tests-windows) should exit 1, got $rc"; fi
if echo "$out" | grep -q "hook-tests-windows ("; then pass "the unwired hook-tests-windows gate is named"; else fail "unwired hook-tests-windows gate not named"; fi
res="$(run_verify "$(mk false true success success | jq -c '."hook-tests-windows".result = "skipped"')")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "hook-tests-windows legit-skip (needs-ci=false, needs-hooks=false) passes (exit 0)"; else fail "hook-tests-windows legit skip should exit 0, got $rc"; fi

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

# --- 50a. TAMPER: docs-internal-gate skipped while needs-docs=true → exit 1 ----
needs="$(mk true true success success success | jq -c '."ci-gate".outputs."needs-docs" = "true" | ."docs-internal-gate".result = "skipped"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "docs-internal-gate skipped while needs-docs=true fails (exit 1)"; else fail "tamper (docs-internal-gate) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring" && echo "$out" | grep -q "docs-internal-gate"; then pass "docs gate tamper is named as possible unwiring"; else fail "docs gate tamper diagnostic missing"; fi

# --- 50b. docs-internal-gate legit-skip while needs-docs=false → exit 0 --------
needs="$(mk true true success success success | jq -c '."docs-internal-gate".result = "skipped"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "docs-internal-gate legit-skip passes (exit 0)"; else fail "docs gate legit skip should exit 0, got $rc"; fi

# --- 50c. docs-internal-gate failure while triggered → exit 1 -----------------
needs="$(mk true true success success success | jq -c '."ci-gate".outputs."needs-docs" = "true" | ."docs-internal-gate".result = "failure"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ] && echo "$out" | grep -q "docs-internal-gate"; then pass "failing triggered docs gate fails and is named"; else fail "failing docs gate was not reported"; fi

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

# --- 54. TAMPER: quality-gates skipped while needs-any-code=true → exit 1 ------
# quality-gates.yml is `workflow_call`-only and ci.yml's `quality-gates:` job is
# its SOLE caller, so on the PR path that one job is the only execution site for
# all three npm audits (web, mcp-server, repo root) plus the cargo audit — cd.yml
# does not run on `pull_request`. An `if: false` on the caller leaves the job
# EXISTING (so ci-success's `needs:` still resolves) and merely SKIPPED, which
# this verifier certified green until the quality-gates map entry was added:
# it fails only on failure/cancelled. 5th mk arg = quality-gates.result.
res="$(run_verify "$(mk true true success success skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "quality-gates skipped while needs-any-code=true fails (exit 1)"; else fail "tamper (quality-gates) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "quality-gates tamper is flagged as a possible unwiring"; else fail "quality-gates tamper message missing"; fi
if echo "$out" | grep -q "quality-gates ("; then pass "the unwired quality-gates job is named"; else fail "unwired quality-gates job not named"; fi

# --- 55. quality-gates job ABSENT from needs while triggered → exit 1 -----------
# The OTHER one-line unwiring, and the cheaper one: deleting `- quality-gates`
# from ci-success's `needs:` list. Valid YAML, no dangling reference, the caller
# keeps running — the required aggregate simply stops waiting on and observing
# it, so a red audit leaves "CI Success" green. `.result // "absent"` reads that
# as absent ≠ success → tamper, but ONLY for jobs this map lists, which is why
# the entry (not the fail-closed default) is what closes this. PF-1010.
needs="$(mk true true success success success | jq -c 'del(."quality-gates")')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "quality-gates absent from needs while triggered fails (exit 1)"; else fail "absent quality-gates should exit 1, got $rc"; fi
if echo "$out" | grep -q "quality-gates ("; then pass "the absent quality-gates job is named"; else fail "absent quality-gates job not named"; fi
if echo "$out" | grep -q "result=absent"; then pass "the absent quality-gates job reports result=absent"; else fail "quality-gates result=absent missing"; fi

# --- 56. quality-gates legit-skips (needs-any-code=false) → exit 0 --------------
# The false-positive guard. A docs-only PR sets needs-any-code=false, the caller
# legitimately skips, and that must NOT read as tamper — otherwise the entry
# above would turn every non-code PR red. `mk` hardcodes needs-any-code=true (it
# is true for essentially every fixture here), so flip it with jq rather than
# adding a 26th positional arg. Everything else path-filter-skips too, matching
# the real shape of a docs-only run.
needs="$(mk false false skipped skipped skipped skipped false skipped false skipped false skipped false skipped false \
  | jq -c '."ci-gate".outputs."needs-any-code" = "false"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "quality-gates legit-skip (needs-any-code=false) passes (exit 0)"; else fail "quality-gates legit skip should exit 0, got $rc"; fi
if echo "$out" | grep -q "All required gates passed"; then pass "docs-only green path prints the all-passed line"; else fail "docs-only all-passed line missing"; fi

# --- 57. quality-gates FAILED while triggered → exit 1 (hard-failure path) ------
# The path this PR exists to protect: a red npm audit inside quality-gates must
# fail the aggregate. Covered by the plain required-gate check (case 1), pinned
# again here so the audit's blocking path is asserted by name.
res="$(run_verify "$(mk true true success success failure)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "quality-gates failure fails (exit 1)"; else fail "quality-gates failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "quality-gates"; then pass "the failing quality-gates job is named"; else fail "failing quality-gates job not named"; fi

# ============================================================================
# #9437 — the three jobs that sat in ci-success's `needs:` with NO anti-tamper
# map entry: command-parity, build-nextjs, test-e2e-ui. Each was a live
# single-line `if: false` vector: the job still EXISTS so ci-success's `needs:`
# resolves, the job merely SKIPS, and this verifier fails only on
# failure/cancelled — so the unwiring certified green. Every case below sets the
# job under test to `skipped` while its OWN trigger is true; the map entry is
# the only thing that turns that into exit 1.
#
# These use a jq post-filter over `mk` rather than new positional args: mk is
# already 26 args wide and these three results are constant-success in every
# other fixture (see the mk header note).
# ============================================================================

# --- 58. TAMPER: command-parity skipped while needs-web=true → exit 1 ----------
# command-parity is the ONLY per-PR proof that the three commands.json copies
# (mcp-server/manifest, web/src/data, apps/docs/data — one per deploy root) stay
# in sync and that every MCP command has a handler. A web-touching PR sets
# needs-web=true, so the job SHOULD run. Every other gate runs+succeeds here, so
# the skipped command-parity job is the SOLE tamper.
needs="$(mk true true success success success | jq -c '."ci-gate".outputs."needs-web" = "true" | ."command-parity".result = "skipped"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "command-parity skipped while needs-web=true fails (exit 1)"; else fail "tamper (command-parity via web arm) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "command-parity tamper is flagged as a possible unwiring"; else fail "command-parity tamper message missing"; fi
if echo "$out" | grep -q "command-parity ("; then pass "the unwired command-parity gate is named (web arm)"; else fail "unwired command-parity gate not named (web arm)"; fi

# --- 59. TAMPER via the needs-mcp arm in ISOLATION: command-parity skipped -----
#         while ONLY needs-mcp=true (needs-web=false) → exit 1.
# command-parity's `if:` is `needs-web || needs-mcp` (ci.yml). An mcp-server-only
# PR — a manifest edit, precisely the change parity exists to catch — sets
# needs-mcp=true with needs-web=false. Mapping only the needs-web arm would leave
# THAT PR's `if: false` skip certified green, so the needs-mcp arm must be
# independently load-bearing. needs-web stays false here (mk's default), so no
# other gate can raise a competing tamper: command-parity is the SOLE one.
needs="$(mk true true success success success | jq -c '."ci-gate".outputs."needs-mcp" = "true" | ."command-parity".result = "skipped"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "command-parity skipped while ONLY needs-mcp=true fails (exit 1)"; else fail "tamper (command-parity via mcp arm) should exit 1, got $rc"; fi
if echo "$out" | grep -q "command-parity ("; then pass "the unwired command-parity gate is named (mcp arm)"; else fail "unwired command-parity gate not named (mcp arm)"; fi

# --- 60. command-parity legit-skips (needs-web=false AND needs-mcp=false) → 0 ---
# A PR touching neither web/ nor mcp-server/ legitimately skips command-parity;
# that must NOT trip the anti-tamper check (proves neither new arm false-positives
# on an unrelated PR).
needs="$(mk true true success success success | jq -c '."command-parity".result = "skipped"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "command-parity legit-skip (web+mcp false) passes (exit 0)"; else fail "command-parity legit skip should exit 0, got $rc"; fi
if echo "$out" | grep -q "All required gates passed"; then pass "command-parity legit-skip prints the all-passed line"; else fail "command-parity legit-skip all-passed line missing"; fi

# --- 61. command-parity FAILED while triggered → exit 1 (hard-failure path) -----
needs="$(mk true true success success success | jq -c '."ci-gate".outputs."needs-mcp" = "true" | ."command-parity".result = "failure"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "command-parity failure fails (exit 1)"; else fail "command-parity failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "command-parity"; then pass "the failing command-parity gate is named"; else fail "failing command-parity gate not named"; fi

# --- 62. command-parity job ABSENT from needs while triggered → exit 1 ----------
# The other one-line unwiring: dropping `- command-parity` from ci-success's
# `needs:` list. Valid YAML, no dangling reference, the job still runs — the
# aggregate simply stops observing it. `.result // "absent"` reads that as
# absent != success → tamper, but ONLY for jobs the map lists, which is exactly
# what the new entry buys.
needs="$(mk true true success success success | jq -c '."ci-gate".outputs."needs-mcp" = "true" | del(."command-parity")')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "command-parity absent from needs while triggered fails (exit 1)"; else fail "absent command-parity should exit 1, got $rc"; fi
if echo "$out" | grep -q "result=absent"; then pass "the absent command-parity job reports result=absent"; else fail "command-parity result=absent missing"; fi

# --- 63. CONFIG DRIFT: needs-mcp renamed/removed from ci-gate outputs → exit 1 --
# `.outputs[$t] // empty` reads a RENAMED or REMOVED output as "did not fire",
# which would silently disarm command-parity's mcp arm while every fixture above
# stayed green (they all carry the key). needs-mcp is newly referenced by the map,
# so pin its fail-closed drift path the way case 51 pins needs-design's.
# command-parity is left `skipped` so the ONLY reason to exit non-zero is the
# missing key itself.
needs="$(mk true true success success success | jq -c '."command-parity".result = "skipped" | del(."ci-gate".outputs."needs-mcp")')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "absent needs-mcp output fails closed (exit 1)"; else fail "absent needs-mcp output should exit 1 (config drift), got $rc"; fi
if echo "$out" | grep -q "missing from ci-gate outputs"; then pass "needs-mcp drift names the missing-output condition"; else fail "needs-mcp config-drift message missing"; fi
if echo "$out" | grep -q "needs-mcp"; then pass "config drift names the missing trigger (needs-mcp)"; else fail "missing needs-mcp trigger not named"; fi

# --- 64. TAMPER: build-nextjs skipped while needs-web=true → exit 1 -------------
# build-nextjs is the ONLY per-PR job that compiles the app — the Next.js
# production build, the native-swc-binding assertion
# (scripts/check-native-bindings.sh) and bundle-size enforcement run there and
# nowhere else on the PR path. A web-touching PR sets needs-web=true, so it SHOULD
# run; an `if: false` skip would let a PR that does not even build merge with
# every required check green.
needs="$(mk true true success success success | jq -c '."ci-gate".outputs."needs-web" = "true" | ."build-nextjs".result = "skipped"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "build-nextjs skipped while needs-web=true fails (exit 1)"; else fail "tamper (build-nextjs) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "build-nextjs tamper is flagged as a possible unwiring"; else fail "build-nextjs tamper message missing"; fi
if echo "$out" | grep -q "build-nextjs ("; then pass "the unwired build-nextjs gate is named"; else fail "unwired build-nextjs gate not named"; fi

# --- 65. build-nextjs legit-skips (needs-web=false) → exit 0 -------------------
needs="$(mk true true success success success | jq -c '."build-nextjs".result = "skipped"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "build-nextjs legit-skip (needs-web=false) passes (exit 0)"; else fail "build-nextjs legit skip should exit 0, got $rc"; fi

# --- 66. build-nextjs FAILED while triggered → exit 1 (hard-failure path) -------
needs="$(mk true true success success success | jq -c '."ci-gate".outputs."needs-web" = "true" | ."build-nextjs".result = "failure"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "build-nextjs failure fails (exit 1)"; else fail "build-nextjs failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "build-nextjs"; then pass "the failing build-nextjs gate is named"; else fail "failing build-nextjs gate not named"; fi

# --- 67. build-nextjs job ABSENT from needs while triggered → exit 1 ------------
needs="$(mk true true success success success | jq -c '."ci-gate".outputs."needs-web" = "true" | del(."build-nextjs")')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "build-nextjs absent from needs while triggered fails (exit 1)"; else fail "absent build-nextjs should exit 1, got $rc"; fi
if echo "$out" | grep -q "result=absent"; then pass "the absent build-nextjs job reports result=absent"; else fail "build-nextjs result=absent missing"; fi

# --- 68. TAMPER: test-e2e-ui skipped while needs-web=true → exit 1 -------------
# test-e2e-ui is the ONLY per-PR run of the 3-shard Playwright UI suite (@ui
# specs). A web-touching PR sets needs-web=true, so it SHOULD run; an `if: false`
# skip is the same single-line unwiring vector guarded for every other gate.
needs="$(mk true true success success success | jq -c '."ci-gate".outputs."needs-web" = "true" | ."test-e2e-ui".result = "skipped"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "test-e2e-ui skipped while needs-web=true fails (exit 1)"; else fail "tamper (test-e2e-ui) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "test-e2e-ui tamper is flagged as a possible unwiring"; else fail "test-e2e-ui tamper message missing"; fi
if echo "$out" | grep -q "test-e2e-ui ("; then pass "the unwired test-e2e-ui gate is named"; else fail "unwired test-e2e-ui gate not named"; fi

# --- 69. test-e2e-ui legit-skips (needs-web=false) → exit 0 -------------------
needs="$(mk true true success success success | jq -c '."test-e2e-ui".result = "skipped"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "test-e2e-ui legit-skip (needs-web=false) passes (exit 0)"; else fail "test-e2e-ui legit skip should exit 0, got $rc"; fi

# --- 70. test-e2e-ui FAILED while triggered → exit 1 (hard-failure path) -------
needs="$(mk true true success success success | jq -c '."ci-gate".outputs."needs-web" = "true" | ."test-e2e-ui".result = "failure"')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "test-e2e-ui failure fails (exit 1)"; else fail "test-e2e-ui failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "test-e2e-ui"; then pass "the failing test-e2e-ui gate is named"; else fail "failing test-e2e-ui gate not named"; fi

# --- 71. test-e2e-ui job ABSENT from needs while triggered → exit 1 ------------
needs="$(mk true true success success success | jq -c '."ci-gate".outputs."needs-web" = "true" | del(."test-e2e-ui")')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "test-e2e-ui absent from needs while triggered fails (exit 1)"; else fail "absent test-e2e-ui should exit 1, got $rc"; fi
if echo "$out" | grep -q "result=absent"; then pass "the absent test-e2e-ui job reports result=absent"; else fail "test-e2e-ui result=absent missing"; fi

# --- 72. ci-gate itself skipped → exit 1 via the drift branch ------------------
# ci-gate is the ONE job in ci-success's `needs:` that the anti-tamper map
# deliberately does not list (it is the SOURCE of the trigger outputs, not a gate
# with an `if:` of its own — mapping it would be circular). That exemption is only
# safe because ci-gate fails CLOSED: a skipped ci-gate publishes no outputs, so
# every mapped trigger goes missing and the drift branch refuses to certify.
# Pin that, so the map-completeness assertion's ci-gate exemption stays justified.
needs="$(mk true true success success success | jq -c '."ci-gate" = { result: "skipped", outputs: {} }')"
res="$(run_verify "$needs")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a skipped ci-gate (no outputs) fails closed (exit 1)"; else fail "skipped ci-gate should exit 1, got $rc"; fi
if echo "$out" | grep -q "missing from ci-gate outputs"; then pass "skipped ci-gate is reported as config drift"; else fail "skipped ci-gate drift message missing"; fi

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
# `npm test` (packages/ui's "test": "vitest run") rather than npx: the
# deprecated `--no-install` spelling could silently regain npx's on-demand
# install; npm run has no install path at all.
UI_TEST_CMD='cd packages/ui && npm test'
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
  # Containment alone is NOT enough, and it fails green. GitHub's YAML parser
  # keeps the LAST of two duplicate keys, so APPENDING a second `run:` to the UI
  # suite step replaces the command under last-key-wins while the ORIGINAL
  # `run: cd packages/ui && npm test` line stays byte-present and still
  # satisfies the containment grep above — the only per-PR run of the UI suite
  # for a packages/ui-only PR is dead, and this pin reads green. On the
  # `pull_request` path GitHub runs the PR's OWN workflow file, so the mutation
  # takes effect in the very run that should have caught it. actionlint flags
  # duplicate keys, but it is not wired into this repo's CI — this count is the
  # backstop (#9031). Scope it to the STEP so sibling steps' legitimate `run:`
  # keys are not counted.
  dig_test_step="$(awk '
    !f && /^      - name:/ && index($0, "Test @spawnforge/ui") {f=1; print; next}
    f && /^      - /{exit}
    f && !/^        / && !/^[[:space:]]*$/{exit}
    f {print}
  ' <<<"$dig_block")"
  if [ -z "$dig_test_step" ]; then
    fail "design-internal-gate has no step named 'Test @spawnforge/ui' — the step cut read nothing, so the run: count below would pass vacuously"
  else
    dig_run_count="$(grep -cE '^[[:space:]]*["'"'"']?run["'"'"']?[[:space:]]*:' <<<"$dig_test_step" || true)"
    if [ "$dig_run_count" -ne 1 ]; then
      fail "design-internal-gate UI suite step has $dig_run_count run: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so an appended run: silently replaces the suite invocation while the original run: line still greps as present)"
    else
      pass "design-internal-gate UI suite step has exactly 1 run: key"
    fi
    if grep -qE "^[[:space:]]*run: cd packages/ui && npm test[[:space:]]*\$" <<<"$dig_test_step"; then
      pass "design-internal-gate runs the UI suite as that step's whole run: line"
    else
      fail "design-internal-gate UI suite step does not run '$UI_TEST_CMD' as its whole run: line — neutered, rewritten, or comment-suffixed"
    fi
  fi
  if grep -v '^[[:space:]]*#' <<<"$dig_block" | grep -q 'continue-on-error'; then
    fail "design-internal-gate must not carry continue-on-error (would shadow a red suite)"
  else
    pass "design-internal-gate has no continue-on-error"
  fi
  # Same last-key-wins hazard on the job-level `if:`: appending a second
  # `if: false` at job level unwires the whole gate while the original
  # needs-design line stays byte-present for the containment check below.
  # Anchor at exactly 4 spaces — job-level keys sit there, and this job carries
  # a LEGITIMATE step-level `if:` at 8 spaces on 'Build @spawnforge/ui' that an
  # any-indent count would false-fail on (#9031).
  dig_if_count="$(grep -cE '^    ["'"'"']?if["'"'"']?[[:space:]]*:' <<<"$dig_block" || true)"
  if [ "$dig_if_count" -ne 1 ]; then
    fail "design-internal-gate has $dig_if_count job-level if: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so an appended constant-false if: unwires the gate while the original if: line still greps as present)"
  else
    pass "design-internal-gate has exactly 1 job-level if: key (a duplicate cannot shadow the pin below)"
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
  if [ "$(grep -v '^[[:space:]]*#' "$SCRIPT" | grep -Ec 'check_triggered "docs-internal-gate"[[:space:]]+"needs-docs"')" -ge 1 ]; then
    pass "verifier anti-tamper map covers docs-internal-gate <-> needs-docs"
  else
    fail "verifier anti-tamper map lost its docs-internal-gate/needs-docs entry"
  fi
  if [ "$(grep -v '^[[:space:]]*#' "$SCRIPT" | grep -Ec 'check_triggered "quality-gates"[[:space:]]+"needs-any-code"')" -ge 1 ]; then
    pass "verifier anti-tamper map covers quality-gates <-> needs-any-code"
  else
    fail "verifier anti-tamper map lost its quality-gates/needs-any-code entry — a skipped or dropped quality-gates job is certified green again, and the npm audits stop being observed on the PR path"
  fi
  # --- MAP COMPLETENESS (#9437) — closes the drift CLASS, not three instances -
  # The anti-tamper map is hand-maintained against ci-success's `needs:` list,
  # which is exactly how command-parity, build-nextjs and test-e2e-ui came to sit
  # in that list with no entry: three live `if: false` vectors that no fixture
  # above could see, because a fixture only exists for a job someone remembered
  # to map. Adding those three entries fixes the instances. This assertion fixes
  # the class: EVERY job ci-success waits on must be mapped, so the next job added
  # to `needs:` cannot land unmapped and silently unprotected.
  #
  # ci-gate is the single documented exemption and it is NOT a hole. It is the
  # SOURCE of the trigger outputs, not a gate with an `if:` of its own, so there
  # is no trigger to map it to; and it fails CLOSED anyway — a skipped or absent
  # ci-gate publishes no outputs, sending every mapped trigger down the verifier's
  # `drift` branch (pinned hermetically by case 72 above). The exemption list is
  # spelled out here rather than inferred, so widening it is a visible diff.
  CI_SUCCESS_MAP_EXEMPT="ci-gate"
  ci_success_blk="$(awk '/^  ci-success:/{f=1} f{print} f && /^  ["'"'"']?[A-Za-z_][A-Za-z0-9_-]*["'"'"']?[[:space:]]*:/ && !/^  ci-success:/{exit}' "$CI_YML")"
  # Cut the `needs:` block list: the 4-space `needs:` key, then its 6-space `- x`
  # items, stopping at the first line that is not one. Trailing comments stripped.
  ci_success_needs="$(awk '
    /^    ["'"'"']?needs["'"'"']?[[:space:]]*:[[:space:]]*$/ {n=1; next}
    n && /^      -[[:space:]]/ { sub(/^      -[[:space:]]*/, ""); sub(/[[:space:]]*#.*$/, ""); sub(/[[:space:]]+$/, ""); gsub(/["'"'"']/, ""); if ($0 != "") print; next }
    n && /^[[:space:]]*$/ { next }
    n {exit}
  ' <<<"$ci_success_blk")"
  ci_success_needs_count="$(printf '%s\n' "$ci_success_needs" | grep -c . || true)"
  # Vacuity guard: an awk cut that reads nothing would make every assertion below
  # pass by iterating an empty list — the precise way a structural pin fails
  # green. Require a plausible list that contains the two jobs we know are there.
  if [ "$ci_success_needs_count" -lt 15 ]; then
    fail "could not parse ci-success's needs: list from ci.yml (got $ci_success_needs_count entries, expected >= 15) — the map-completeness assertions below would pass vacuously"
  elif ! grep -qx 'ci-gate' <<<"$ci_success_needs" || ! grep -qx 'quality-gates' <<<"$ci_success_needs"; then
    fail "parsed ci-success needs: list is missing known jobs (ci-gate / quality-gates) — the cut is wrong, so the map-completeness assertions below are unreliable"
  else
    pass "parsed ci-success's needs: list from ci.yml ($ci_success_needs_count jobs)"
    map_jobs="$(grep -v '^[[:space:]]*#' "$SCRIPT" | grep -Eo '^check_triggered[[:space:]]+"[^"]+"' | sed -E 's/^check_triggered[[:space:]]+"([^"]+)"$/\1/')"
    unmapped=""
    while IFS= read -r job; do
      [ -n "$job" ] || continue
      case " $CI_SUCCESS_MAP_EXEMPT " in *" $job "*) continue ;; esac
      grep -qx -- "$job" <<<"$map_jobs" || unmapped="$unmapped $job"
    done <<<"$ci_success_needs"
    if [ -n "$unmapped" ]; then
      fail "job(s) in ci-success's needs: list have NO check_triggered entry in $SCRIPT —$unmapped. Each is a silent \`if: false\` vector: the job skips, ci-success's needs: still resolves, and the verifier fails only on failure/cancelled, so the unwiring certifies green. Add a check_triggered entry naming EVERY arm of the job's own if:."
    else
      pass "every job in ci-success's needs: list is covered by the anti-tamper map (exempt: $CI_SUCCESS_MAP_EXEMPT)"
    fi
    # Reverse direction: an entry for a job ci-success does not wait on is
    # decorative — the job's result never reaches NEEDS_JSON, so `result=absent`
    # would fire on every run (or, worse, the entry is silently dead after a
    # rename). Keeps the two lists in genuine lockstep rather than one-way.
    stale=""
    while IFS= read -r job; do
      [ -n "$job" ] || continue
      grep -qx -- "$job" <<<"$ci_success_needs" || stale="$stale $job"
    done <<<"$map_jobs"
    if [ -n "$stale" ]; then
      fail "anti-tamper map entr(ies) name job(s) absent from ci-success's needs: list —$stale. The verifier never sees their result, so the entry protects nothing (renamed or removed job?)."
    else
      pass "every anti-tamper map entry names a job ci-success actually waits on"
    fi
  fi
  # Pin the three #9437 entries by name AND trigger, the way the design/docs/
  # quality-gates entries above are pinned: completeness alone would accept
  # `check_triggered "command-parity" "needs-hooks"` — mapped, but to a trigger
  # that never fires with the job, which is decorative. `grep -c` (not -q) for the
  # pipefail/SIGPIPE reason noted above.
  if [ "$(grep -v '^[[:space:]]*#' "$SCRIPT" | grep -Ec 'check_triggered "command-parity"[[:space:]]+"needs-web"[[:space:]]+"needs-mcp"')" -ge 1 ]; then
    pass "verifier anti-tamper map covers command-parity <-> needs-web + needs-mcp (both if: arms)"
  else
    fail "verifier anti-tamper map lost its command-parity entry, or stopped naming BOTH arms of its if: (needs-web, needs-mcp) — an mcp-server-only PR could skip the manifest-parity check with every required gate green"
  fi
  if [ "$(grep -v '^[[:space:]]*#' "$SCRIPT" | grep -Ec 'check_triggered "build-nextjs"[[:space:]]+"needs-web"')" -ge 1 ]; then
    pass "verifier anti-tamper map covers build-nextjs <-> needs-web"
  else
    fail "verifier anti-tamper map lost its build-nextjs/needs-web entry — the only per-PR Next.js production build, native-swc-binding assertion and bundle-size check stop being observed"
  fi
  if [ "$(grep -v '^[[:space:]]*#' "$SCRIPT" | grep -Ec 'check_triggered "test-e2e-ui"[[:space:]]+"needs-web"')" -ge 1 ]; then
    pass "verifier anti-tamper map covers test-e2e-ui <-> needs-web"
  else
    fail "verifier anti-tamper map lost its test-e2e-ui/needs-web entry — the only per-PR run of the Playwright UI shards stops being observed"
  fi
  # And pin the real `if:` each new entry is paired with, matching the
  # quality-gates caller pin below: a map entry paired with a trigger that no
  # longer gates the job is decorative. Whole expression, on the `if:` line only,
  # comments stripped — so `!= 'true'` inversion and trailing-comment survival
  # both fail (the three vectors documented at the quality-gates pin).
  for pair in "command-parity:needs-web:needs-mcp" "build-nextjs:needs-web" "test-e2e-ui:needs-web"; do
    pj="${pair%%:*}"; ptrigs="${pair#*:}"
    pblk="$(awk -v j="  $pj:" '$0==j{f=1} f{print} f && /^  ["'"'"']?[A-Za-z_][A-Za-z0-9_-]*["'"'"']?[[:space:]]*:/ && $0!=j{exit}' "$CI_YML")"
    pif="$(grep -v '^[[:space:]]*#' <<<"$pblk" | sed 's/#.*$//' | grep -E '^    ["'"'"']?if["'"'"']?[[:space:]]*:')"
    pif_count="$(grep -cE '^    ["'"'"']?if["'"'"']?[[:space:]]*:' <<<"$pblk" || true)"
    if [ -z "$pblk" ]; then
      fail "ci.yml has no $pj job block — the map entry above is paired with a job that no longer exists"
    elif [ "$pif_count" -ne 1 ]; then
      # Last-key-wins: an appended second job-level `if: false` unwires the job
      # while the original trigger line stays byte-present for the pin below.
      fail "ci.yml $pj has $pif_count job-level if: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so an appended constant-false if: unwires the job while the original if: line still greps as present)"
    else
      pmissing=""
      while IFS= read -r t; do
        [ -n "$t" ] || continue
        grep -qF "needs.ci-gate.outputs.$t == 'true'" <<<"$pif" || pmissing="$pmissing $t"
      done <<<"$(tr ':' '\n' <<<"$ptrigs")"
      if [ -n "$pmissing" ]; then
        fail "ci.yml $pj's if: no longer contains \"needs.ci-gate.outputs.<t> == 'true'\" for:$pmissing — the map entry above is paired with a trigger that no longer gates the job (renamed, inverted to != 'true', or dropped)"
      else
        pass "ci.yml $pj's if: is gated on $(tr ':' ' ' <<<"$ptrigs") (matches the map entry)"
      fi
    fi
  done
  # The trigger named in the map must be the one the caller's own `if:` is gated
  # on, or the arm is mapped to an output that never fires with the job and the
  # entry above is decorative. Cut the caller job block and pin the pairing.
  #
  # Three vectors were measured against a caller degated to `if: false`, each of
  # which an earlier form of this pin certified with an affirmative PASS. All
  # three are closed here, and the shape that closes them is the one the
  # design-internal-gate pin above already uses -- match the WHOLE expression as
  # a fixed string, on the `if:` line alone:
  #   1. run-on cut. A bare-key terminator (`^  [A-Za-z_]...:`) does not stop at
  #      a QUOTED job key, so `'command-parity':` let the cut swallow following
  #      jobs and find the needle in one of them. Terminator now tolerates
  #      optional quotes. Same defect the guide records at :42.
  #   2. trailing-comment survival. Stripping only FULL-line comments left a
  #      needle alive inside a YAML trailing comment (`can-commit-ratchet: false
  #      # needs-any-code`) -- tampering, not wiring (guide :105). Trailing
  #      comments are now stripped and the needle is sought on the `if:` line
  #      only, not anywhere in the block.
  #   3. gate inversion. `needs-any-code != 'true'` still NAMES needs-any-code,
  #      so any substring match passes it while the job runs only when there is
  #      no code change -- dead for exactly the PRs it must gate. Only the full
  #      `== 'true'` expression rejects it.
  # `grep -q` is safe here (cf. the pipefail/SIGPIPE note above): the input is
  # one job block, then one line, so the upstream always finishes writing.
  qg_caller_blk="$(awk '/^  quality-gates:/{f=1} f{print} f && /^  ["'"'"']?[A-Za-z_][A-Za-z0-9_-]*["'"'"']?[[:space:]]*:/ && !/^  quality-gates:/{exit}' "$CI_YML")"
  qg_caller_if="$(grep -v '^[[:space:]]*#' <<<"$qg_caller_blk" | sed 's/#.*$//' | grep -E '^    ["'"'"']?if["'"'"']?[[:space:]]*:')"
  if [ -z "$qg_caller_blk" ]; then
    fail "ci.yml quality-gates caller job block is empty — cannot verify its if: trigger"
  elif [ -z "$qg_caller_if" ]; then
    fail "ci.yml quality-gates caller has no job-level if: — cannot verify the trigger the map entry above is paired with"
  elif grep -qF "needs.ci-gate.outputs.needs-any-code == 'true'" <<<"$qg_caller_if"; then
    pass "ci.yml quality-gates caller if: is gated on needs-any-code == 'true' (matches the map entry)"
  else
    fail "ci.yml quality-gates caller's if: is no longer exactly \"needs.ci-gate.outputs.needs-any-code == 'true'\" — the map entry above is paired with a trigger that no longer gates the job"
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
