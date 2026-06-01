#!/usr/bin/env bash
# Unit tests for scripts/check-lockfile-sync.sh — the lockfile-drift gate —
# plus structural assertions that the gate is wired into ci.yml's required
# `ci-success` aggregate (a standalone path-filtered workflow can never be a
# safe required check, so the gate has to ride the existing ci-gate/ci-success
# pattern instead).
#
# WHY THIS GATE EXISTS
# --------------------
# This is a single-root-lockfile monorepo: only ONE package-lock.json (repo
# root) governs web/, mcp-server/ and the root workspace. A Dependabot npm PR
# scoped to `directory: /web` (or a hand-edit) can change web/package.json
# WITHOUT regenerating the root lockfile. The manifest range then no longer
# matches the pinned lockfile version, and every `npm ci` (which all of CI and
# the Quality Gates jobs run) fails with EUSAGE on main. This happened twice
# (#8655, #8658 → #8683). `npm ci`'s own EUSAGE check only fires AFTER such a
# change lands; this gate fires BEFORE merge, deterministically.
#
# HERMETIC TESTING
# ----------------
# The gate's real regeneration step (`npm install --package-lock-only`) needs
# the network and is environment-sensitive, so the script reads the regenerate
# command from $LOCKFILE_REGEN_CMD. These tests inject a stub command that
# simulates the outcomes (no-op = in sync, mutate = drift, partial-write+fail,
# hard-fail) in a throwaway git repo. The real npm invocation is exercised by
# CI, not here — these tests pin the branching/exit-code/messaging contract.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../check-lockfile-sync.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "gate script not found: $SCRIPT"; exit 1; }

# Build a throwaway git repo containing a committed root package-lock.json.
# Echoes the repo path. Caller is responsible for rm -rf.
make_repo() {
  local repo
  repo="$(mktemp -d)"
  (
    cd "$repo" || exit 1
    git init -q
    git config user.email t@t.t
    git config user.name t
    printf '{\n  "name": "root",\n  "lockfileVersion": 3,\n  "packages": {}\n}\n' > package-lock.json
    printf '{\n  "name": "root"\n}\n' > package.json
    git add -A
    git commit -qm init
  )
  echo "$repo"
}

# Run the gate inside $repo with a given regenerate stub; echo "<exit>|<output>".
run_gate() {
  local repo="$1" regen="$2" out rc
  out="$(cd "$repo" && LOCKFILE_REGEN_CMD="$regen" bash "$SCRIPT" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

echo "=== check-lockfile-sync.sh tests ==="

# --- 1. In sync: regen is a no-op → exit 0 + success message -----------------
repo="$(make_repo)"
res="$(run_gate "$repo" "true")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "in-sync lockfile passes (exit 0)"; else fail "in-sync should exit 0, got $rc"; fi
if echo "$out" | grep -qi "in sync"; then pass "in-sync prints a success message"; else fail "in-sync success message missing"; fi
rm -rf "$repo"

# --- 2. Drift: regen mutates the lockfile → exit 1 + drift message -----------
repo="$(make_repo)"
res="$(run_gate "$repo" 'printf "\n  \"drift\": true\n" >> package-lock.json')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "drift fails (exit 1)"; else fail "drift should exit 1, got $rc"; fi
if echo "$out" | grep -qi "drift detected"; then pass "drift prints 'drift detected'"; else fail "drift message missing"; fi
if echo "$out" | grep -q "npm install --package-lock-only"; then pass "drift prints the remediation command"; else fail "remediation command missing"; fi
rm -rf "$repo"

# --- 3. Drift is non-destructive: gate exits 1 AND restores the working tree -
# Assert BOTH the exit code and the clean tree — a gate that silently passed on
# drift (rc 0) would still leave a clean tree, so the tree check alone is not
# enough to prove drift was detected.
repo="$(make_repo)"
res="$(run_gate "$repo" 'printf "\n  \"drift\": true\n" >> package-lock.json')"
rc="${res%%|*}"
if [ "$rc" = "1" ]; then pass "drift detection returns exit 1 (non-destructive case)"; else fail "drift should exit 1, got $rc"; fi
if (cd "$repo" && git diff --quiet -- package-lock.json); then
  pass "lockfile restored after drift (clean working tree)"
else
  fail "gate left the lockfile mutated"
fi
rm -rf "$repo"

# --- 4. Regen command itself fails → exit 1, clear message, surfaced output,
#        AND a partial write is rolled back ----------------------------------
# The stub writes a partial mutation and THEN fails, so this exercises the
# regen-failure restore branch (git checkout) that a `false`-only stub leaves
# untouched. It also emits a diagnostic on stderr that the gate MUST surface —
# silencing npm's real error turns an actionable failure into a cryptic one.
#
# The marker is ASSEMBLED at runtime ($(printf MARKER)) so the literal command
# string the gate echoes ("regeneration command failed: <cmd>") can never
# contain the resolved "REGEN_DIAG_MARKER" — the assertion below therefore only
# passes if the gate genuinely captured and surfaced the command's own stderr,
# not merely re-printed the command it ran.
repo="$(make_repo)"
# SC2016: the $(printf MARKER) is intentionally NOT expanded by this shell — the
# stub string is passed verbatim to the gate, which evals it. Resolving it here
# would defeat the test (see the marker-assembly note above).
# shellcheck disable=SC2016
res="$(run_gate "$repo" 'printf "\n  \"partial\": true\n" >> package-lock.json; printf "REGEN_DIAG_%s\n" "$(printf MARKER)" >&2; false')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "regen failure fails (exit 1)"; else fail "regen failure should exit 1, got $rc"; fi
if echo "$out" | grep -qi "regeneration command failed"; then pass "regen failure has clear message"; else fail "regen failure message missing"; fi
if echo "$out" | grep -q "REGEN_DIAG_MARKER"; then pass "regen failure surfaces the command's own output"; else fail "regen failure swallowed the underlying diagnostic"; fi
if (cd "$repo" && git diff --quiet -- package-lock.json); then
  pass "partial write rolled back on regen failure (clean working tree)"
else
  fail "gate left a partial lockfile write after regen failure"
fi
rm -rf "$repo"

# --- 5. No lockfile present → exit 1 -----------------------------------------
repo="$(mktemp -d)"
( cd "$repo" && git init -q && git config user.email t@t.t && git config user.name t \
    && printf '{}' > package.json && git add -A && git commit -qm init )
res="$(run_gate "$repo" "true")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "missing lockfile fails (exit 1)"; else fail "missing lockfile should exit 1, got $rc"; fi
if echo "$out" | grep -qi "not found"; then pass "missing lockfile has clear message"; else fail "missing lockfile message missing"; fi
rm -rf "$repo"

echo ""
echo "=== ci.yml integration wiring ==="
# A standalone path-filtered workflow cannot be a SAFE required check: a PR that
# touches none of its paths never starts it, so GitHub reports 'Expected'
# forever and the PR is blocked indefinitely. The only safe way to enforce a
# path-sensitive gate in this repo is to ride the ci-gate → ci-success pattern:
# a job that is skipped (not failed) on irrelevant PRs, and is in ci-success's
# `needs:` so it is required when it DOES run. These assertions pin that wiring
# so a future edit cannot silently demote the gate back to advisory-only.
if [ -f "$CI_YML" ]; then
  ci="$(cat "$CI_YML")"

  if echo "$ci" | grep -qE '^  lockfile-sync:'; then
    pass "ci.yml defines a lockfile-sync job"
  else
    fail "ci.yml has no lockfile-sync job (gate is not in the required pipeline)"
  fi

  if echo "$ci" | grep -qE 'needs-deps:'; then
    pass "ci-gate exposes a needs-deps output"
  else
    fail "ci-gate has no needs-deps output to gate the lockfile job on"
  fi

  # The deps detector must match a package.json at ANY depth (apps/*, packages/*,
  # web/, mcp-server/) — not just the root — so new workspaces are covered.
  if echo "$ci" | grep -qE "package\\\\?\.json" && echo "$ci" | grep -q 'deps=true'; then
    pass "ci-gate deps detection keys on package.json changes"
  else
    fail "ci-gate does not set deps=true on package.json changes"
  fi

  if echo "$ci" | grep -A12 '^  lockfile-sync:' | grep -q 'needs-deps'; then
    pass "lockfile-sync job is gated on needs-deps (skips when no manifest changed)"
  else
    fail "lockfile-sync job is not gated on needs-deps"
  fi

  if echo "$ci" | grep -q 'check-lockfile-sync.sh'; then
    pass "lockfile-sync job runs scripts/check-lockfile-sync.sh"
  else
    fail "ci.yml never invokes the gate script"
  fi

  # ci-success's needs: list is the required-check surface. Pull the block from
  # 'ci-success:' to its steps: and assert lockfile-sync is one of its needs.
  if echo "$ci" | awk '/^  ci-success:/{f=1} f{print} /^    steps:/{if(f)exit}' | grep -q '      - lockfile-sync'; then
    pass "ci-success requires the lockfile-sync job"
  else
    fail "lockfile-sync is not in ci-success needs — gate is not required"
  fi
else
  fail "ci.yml not found at $CI_YML"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
