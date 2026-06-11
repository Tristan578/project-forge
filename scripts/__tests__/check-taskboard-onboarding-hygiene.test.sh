#!/usr/bin/env bash
# Contract test for scripts/check-taskboard-onboarding-hygiene.sh — the taskboard
# onboarding-hygiene tripwire.
#
# WHY THIS GATE EXISTS
# The taskboard's project/team IDs were rotated and the runbook forbids the
# `--db` start flag, but two classes of STALE FACT lingered across ~18
# contributor-facing files (provider rules, kanban skills, README, CONTRIBUTING)
# and two functional hooks:
#   (1) STALE-ID    — a dead project/team ULID (404s; board-summary reported 0).
#   (2) FORBIDDEN-DB — a `taskboard start ... --db .claude/taskboard.db` command
#                      (creates an empty local DB → board shows 0 tickets).
# A Codex/Gemini/Windsurf/Antigravity contributor was onboarded against a broken
# board. The agentic-sync generator keeps the canonical FACTS BLOCK in sync
# across the 4 primary onboarding files, but it cannot reach a fact embedded
# inline in a curl command, a table row, a code fence, or a non-target provider
# file (.windsurf/.agent/.agents). This tripwire is the negative guard the parity
# review called for: it greps the whole tree and fails the PR if either stale
# fact reappears, anywhere, in any file type.
#
# The legitimate homes for a stale fact (as DATA) are allowlisted:
#   * docs/reviews/2026-06-02-agentic-toolkit-parity-review.md — DOCUMENTS the
#     staleness as a finding.
#   * .claude/hooks/github-sync-config.json — its `legacyProjectIds` array is the
#     intentional old->new mapping; the dead PROJECT id lives there by design.
#     (Dead TEAM ids are NOT allowlisted there — they have no legacy use.)
#
# Like the lockfile-sync / agentic-sync suites, this drives the REAL script
# through its CLI contract against a hermetic fixture tree (a STALE_ID_SCAN_ROOT
# temp dir), so it needs no network and never scans the repo's own files. Exit
# 0 = clean, exit 1 = a stale fact was found — those two codes ARE the behavior,
# so the cases assert on them directly. Assertions use explicit if/then/else (NOT
# `A && ok || bad`) so the suite is SC2015-clean for CI's shellcheck self-defense.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$REPO_ROOT/scripts/check-taskboard-onboarding-hygiene.sh"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
CI_SUCCESS="$REPO_ROOT/scripts/check-ci-success.sh"

# --- host guards -------------------------------------------------------------
command -v grep   >/dev/null 2>&1 || { echo "FATAL: grep not found on host";   exit 1; }
command -v mktemp >/dev/null 2>&1 || { echo "FATAL: mktemp not found on host"; exit 1; }

PASS=0
FAIL=0
ok()  { echo "  ok: $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# --- the four known-dead taskboard ULIDs (mirror the script's banned set) -----
DEAD_PROJECT="01KK974VMNC16ZAW7MW1NH3T3M"
DEAD_ENG="01KK9751NZ4HM7VQM0AQ5WGME3"
DEAD_PM="01KK9751P7GKQYG9TZ96XXQCFN"
DEAD_LEAD="01KK9751PD79RCWY462CYQ06CW"
# Live (correct) IDs — these must NEVER trip the guard.
LIVE_PROJECT="01KMM9ZA6SBZ7RKJZJTZS9VR4R"
LIVE_ENG="01KMR5E36TP59PRQA8GQEWJVM1"
LIVE_PM="01KMR5E3852BWXAZ219W47CSKS"

# The forbidden start invocation and its many legitimate look-alikes. The WARN_*
# strings reproduce real markdown warnings verbatim, backticks and all, as
# LITERAL fixture data — single quotes are deliberate (no shell expansion wanted),
# so the SC2016 "expressions don't expand" hint is a false positive here.
FORBIDDEN_DB="cd project-forge && taskboard start --port 3010 --db .claude/taskboard.db"
FORBIDDEN_DB_EQ="taskboard start --port 3010 --db=.claude/taskboard.db"
WARN_NO_FLAG="taskboard start --port 3010    # NO --db flag — use OS default"
# shellcheck disable=SC2016
WARN_NEVER_PASS='**CRITICAL:** NEVER pass `--db .claude/taskboard.db` — empty copy'
# shellcheck disable=SC2016
WARN_REVERSED='never pass `--db .claude/taskboard.db` to `taskboard start`'

ALLOW_DOC="docs/reviews/2026-06-02-agentic-toolkit-parity-review.md"
ALLOW_CFG=".claude/hooks/github-sync-config.json"

mkroot() { mktemp -d; }
run_guard() { # <root> → runs the REAL tripwire against the fixture tree
  local root="$1"
  STALE_ID_SCAN_ROOT="$root" bash "$GUARD"
}

# =============================================================================
echo "== tripwire: script exists and is executable =="
if [ -f "$GUARD" ]; then ok "guard script present"; else bad "guard script missing: $GUARD"; fi

# =============================================================================
echo "== clean tree (live IDs, --db-free start) =="
root="$(mkroot)"
printf 'project: %s\neng: %s\npm: %s\n' "$LIVE_PROJECT" "$LIVE_ENG" "$LIVE_PM" > "$root/AGENTS.md"
printf 'Start: taskboard start --port 3010\n' > "$root/README.md"
run_guard "$root" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then ok "clean tree (all three live IDs) → exit 0"; else bad "clean tree should pass, got exit $rc"; fi
rm -rf "$root"

# =============================================================================
echo "== dead PROJECT id (not allowlisted) =="
root="$(mkroot)"
printf 'Project ID: %s\n' "$DEAD_PROJECT" > "$root/.windsurf-rules.md"
run_guard "$root" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 1 ]; then ok "dead project id → exit 1"; else bad "dead project id should fail, got exit $rc"; fi
rm -rf "$root"

# =============================================================================
echo "== dead TEAM ids (eng/pm/lead, not allowlisted) =="
for dead in "$DEAD_ENG" "$DEAD_PM" "$DEAD_LEAD"; do
  root="$(mkroot)"
  printf 'Team: %s\n' "$dead" > "$root/taskboard-sync.md"
  run_guard "$root" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 1 ]; then ok "dead team id $dead → exit 1"; else bad "dead team id $dead should fail, got exit $rc"; fi
  rm -rf "$root"
done

# =============================================================================
echo "== forbidden 'taskboard start ... --db <path>' invocation =="
root="$(mkroot)"
mkdir -p "$root/.windsurf/rules"
printf '%s\n' "$FORBIDDEN_DB" > "$root/.windsurf/rules/taskboard.md"
run_guard "$root" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 1 ]; then ok "forbidden --db invocation (space form) → exit 1"; else bad "forbidden --db should fail, got exit $rc"; fi
rm -rf "$root"

root="$(mkroot)"
printf '%s\n' "$FORBIDDEN_DB_EQ" > "$root/CONTRIBUTING.md"
run_guard "$root" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 1 ]; then ok "forbidden --db invocation (= form) → exit 1"; else bad "forbidden --db= should fail, got exit $rc"; fi
rm -rf "$root"

# =============================================================================
echo "== forbidden-invocation offender output labels the file and the FORBIDDEN-DB class =="
root="$(mkroot)"
printf '%s\n' "$FORBIDDEN_DB" > "$root/CONTRIBUTING.md"
out="$(run_guard "$root" 2>&1)"
if printf '%s' "$out" | grep -q "CONTRIBUTING.md"; then ok "offender output names the file"; else bad "offender output omits the file path"; fi
if printf '%s' "$out" | grep -q "FORBIDDEN-DB"; then ok "offender output labels the FORBIDDEN-DB class"; else bad "offender output omits the FORBIDDEN-DB label"; fi
rm -rf "$root"

# =============================================================================
echo "== legitimate --db WARNINGS must NOT trip (precise pattern) =="
root="$(mkroot)"
printf '%s\n' "$WARN_NO_FLAG"     > "$root/skill.md"      # 'taskboard start ... # NO --db flag' (no path)
printf '%s\n' "$WARN_NEVER_PASS"  > "$root/setup.md"      # '--db .claude/taskboard.db' but no 'taskboard start'
printf '%s\n' "$WARN_REVERSED"    > "$root/hook.sh"       # reversed order: '--db ...' before 'taskboard start'
run_guard "$root" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then ok "all three --db warning forms ignored → exit 0"; else bad "a --db warning was false-flagged, got exit $rc"; fi
rm -rf "$root"

# =============================================================================
echo "== combined: a dead id AND a forbidden invocation both report =="
root="$(mkroot)"
printf 'Project ID: %s\n' "$DEAD_PROJECT" > "$root/.windsurf-rules.md"
printf '%s\n' "$FORBIDDEN_DB" > "$root/CONTRIBUTING.md"
out="$(run_guard "$root" 2>&1)"
rc=$?
if [ "$rc" -eq 1 ]; then ok "combined defects → exit 1"; else bad "combined defects should fail, got exit $rc"; fi
if printf '%s' "$out" | grep -q "STALE-ID"; then ok "combined output reports the STALE-ID defect"; else bad "combined output omits STALE-ID"; fi
if printf '%s' "$out" | grep -q "FORBIDDEN-DB"; then ok "combined output reports the FORBIDDEN-DB defect"; else bad "combined output omits FORBIDDEN-DB"; fi
rm -rf "$root"

# =============================================================================
echo "== offender output names the file and the id (stale-id class) =="
root="$(mkroot)"
printf 'Project ID: %s\n' "$DEAD_PROJECT" > "$root/CONTRIBUTING.md"
out="$(run_guard "$root" 2>&1)"
if printf '%s' "$out" | grep -q "CONTRIBUTING.md"; then ok "offender output names the file"; else bad "offender output omits the file path"; fi
if printf '%s' "$out" | grep -q "$DEAD_PROJECT"; then ok "offender output names the dead id"; else bad "offender output omits the dead id"; fi
if printf '%s' "$out" | grep -q "STALE-ID"; then ok "offender output labels the STALE-ID class"; else bad "offender output omits the STALE-ID label"; fi
rm -rf "$root"

# =============================================================================
echo "== allowlist: parity-review doc may quote dead ids AND the forbidden command =="
root="$(mkroot)"
mkdir -p "$root/docs/reviews"
{
  printf 'finding: dead ids %s %s %s %s\n' "$DEAD_PROJECT" "$DEAD_ENG" "$DEAD_PM" "$DEAD_LEAD"
  printf 'finding: the forbidden command was %s\n' "$FORBIDDEN_DB"
} > "$root/$ALLOW_DOC"
run_guard "$root" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then ok "review doc with all dead facts → exit 0 (allowlisted)"; else bad "review doc should be allowlisted, got exit $rc"; fi
rm -rf "$root"

# =============================================================================
echo "== allowlist: github-sync-config legacyProjectIds may hold the dead PROJECT id =="
root="$(mkroot)"
mkdir -p "$root/.claude/hooks"
cat > "$root/$ALLOW_CFG" <<JSON
{
  "localProjectId": "$LIVE_PROJECT",
  "legacyProjectIds": ["$DEAD_PROJECT", "01KMM7VST5NY7GN3T3QK9M2B6K"]
}
JSON
run_guard "$root" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then ok "config legacy PROJECT id → exit 0 (allowlisted)"; else bad "config legacy project id should be allowlisted, got exit $rc"; fi
rm -rf "$root"

# =============================================================================
echo "== allowlist is NARROW: a dead TEAM id in the config still fails =="
root="$(mkroot)"
mkdir -p "$root/.claude/hooks"
cat > "$root/$ALLOW_CFG" <<JSON
{
  "localProjectId": "$LIVE_PROJECT",
  "legacyProjectIds": ["$DEAD_PROJECT"],
  "oops": "$DEAD_ENG"
}
JSON
run_guard "$root" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 1 ]; then ok "dead TEAM id in config still trips (allowlist is project-id-only) → exit 1"; else bad "dead team id in config should fail, got exit $rc"; fi
rm -rf "$root"

# =============================================================================
echo "== excluded directories are not scanned =="
for d in node_modules .git dist build .next target .turbo; do
  root="$(mkroot)"
  mkdir -p "$root/$d"
  printf 'stale %s\n%s\n' "$DEAD_PROJECT" "$FORBIDDEN_DB" > "$root/$d/junk.md"
  run_guard "$root" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then ok "stale facts under $d/ are ignored → exit 0"; else bad "$d/ should be excluded, got exit $rc"; fi
  rm -rf "$root"
done

# =============================================================================
echo "== the tripwire's own files are excluded (they name the dead facts as data) =="
root="$(mkroot)"
mkdir -p "$root/scripts/__tests__"
printf 'patterns %s %s\n%s\n' "$DEAD_PROJECT" "$DEAD_ENG" "$FORBIDDEN_DB" > "$root/scripts/check-taskboard-onboarding-hygiene.sh"
printf 'fixtures %s %s\n%s\n' "$DEAD_PM" "$DEAD_LEAD" "$FORBIDDEN_DB" > "$root/scripts/__tests__/check-taskboard-onboarding-hygiene.test.sh"
run_guard "$root" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then ok "guard + its test excluded by name → exit 0"; else bad "guard self-exclusion failed, got exit $rc"; fi
rm -rf "$root"

# =============================================================================
echo "== near-miss ULIDs do not trip (exact match only) =="
root="$(mkroot)"
printf 'truncated %s\n' "${DEAD_PROJECT%?}" > "$root/a.md"          # one char short
printf 'extended %sZ\n' "$DEAD_PROJECT" > "$root/b.md"             # dead id is a substring → still a match
printf 'typo 01KK974VMNC16ZAW7MW1NH3T3X\n' > "$root/c.md"          # last char differs
run_guard "$root" >/dev/null 2>&1
rc=$?
# b.md embeds the full dead id as a substring → MUST trip. So overall exit 1.
if [ "$rc" -eq 1 ]; then ok "exact dead id as a substring trips; truncation/typo alone do not"; else bad "substring-of-dead-id should fail, got exit $rc"; fi
# Now drop b.md: truncation + typo only → must pass.
rm -f "$root/b.md"
run_guard "$root" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then ok "truncated + typo'd ULIDs alone → exit 0"; else bad "near-miss-only tree should pass, got exit $rc"; fi
rm -rf "$root"

# =============================================================================
echo "== empty tree =="
root="$(mkroot)"
run_guard "$root" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then ok "empty tree → exit 0"; else bad "empty tree should pass, got exit $rc"; fi
rm -rf "$root"

# =============================================================================
echo "== structural wiring: tripwire is a required, self-defending CI gate =="
if [ -f "$CI_YML" ]; then
  if grep -q "check-taskboard-onboarding-hygiene.sh" "$CI_YML"; then
    ok "ci.yml invokes the tripwire"
  else
    bad "ci.yml does not invoke check-taskboard-onboarding-hygiene.sh"
  fi
  if grep -Eq "taskboard-onboarding-guard" "$CI_YML"; then
    ok "ci.yml defines the taskboard-onboarding-guard job"
  else
    bad "ci.yml has no taskboard-onboarding-guard job"
  fi
  # The job must be a dependency of ci-success (required aggregate), not a
  # free-floating advisory check.
  if grep -Eq "^\s*-\s*taskboard-onboarding-guard" "$CI_YML"; then
    ok "taskboard-onboarding-guard is listed under a needs: block (wired into an aggregate)"
  else
    bad "taskboard-onboarding-guard is not referenced as a needs: dependency"
  fi
  # The job's own `if:` must gate on the SAME ci-gate output the anti-tamper maps
  # it to (needs-onboarding). A name-only grep would pass even if the trigger were
  # silently rewired to a never-true output, leaving the gate dead while present.
  if grep -Eq "needs\.ci-gate\.outputs\.needs-onboarding == 'true'" "$CI_YML"; then
    ok "taskboard-onboarding-guard job is gated on needs-onboarding (trigger wired)"
  else
    bad "taskboard-onboarding-guard job is not gated on needs-onboarding"
  fi
else
  bad "ci.yml not found at $CI_YML"
fi

# The anti-tamper verifier must MAP THIS job to THIS trigger, not merely mention
# the string. Assert the exact check_triggered call so a dropped/renamed trigger
# arm (which would reopen the `if: false` skip vector) fails this suite.
if [ -f "$CI_SUCCESS" ]; then
  if grep -Eq 'check_triggered[[:space:]]+"taskboard-onboarding-guard"[[:space:]]+"needs-onboarding"' "$CI_SUCCESS"; then
    ok "check-ci-success.sh maps taskboard-onboarding-guard → needs-onboarding (exact anti-tamper wiring)"
  else
    bad "check-ci-success.sh does not map taskboard-onboarding-guard to needs-onboarding"
  fi
else
  bad "check-ci-success.sh not found at $CI_SUCCESS"
fi

# =============================================================================
echo ""
echo "== summary =="
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -ne 0 ]; then exit 1; fi
exit 0
