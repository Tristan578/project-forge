#!/usr/bin/env bash
# Unit tests for scripts/check-lockfile-sync.sh — the lockfile-drift gate.
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
# simulates the two outcomes (no-op = in sync, mutate = drift) plus the failure
# modes, in a throwaway git repo. The real npm invocation is exercised by CI,
# not here — these tests pin the branching/exit-code/messaging contract.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../check-lockfile-sync.sh"
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

# --- 1. In sync: regen is a no-op → exit 0 -----------------------------------
repo="$(make_repo)"
res="$(run_gate "$repo" "true")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "in-sync lockfile passes (exit 0)"; else fail "in-sync should exit 0, got $rc"; fi
rm -rf "$repo"

# --- 2. Drift: regen mutates the lockfile → exit 1 + drift message -----------
repo="$(make_repo)"
res="$(run_gate "$repo" 'printf "\n  \"drift\": true\n" >> package-lock.json')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "drift fails (exit 1)"; else fail "drift should exit 1, got $rc"; fi
if echo "$out" | grep -qi "drift detected"; then pass "drift prints 'drift detected'"; else fail "drift message missing"; fi
if echo "$out" | grep -q "npm install --package-lock-only"; then pass "drift prints the remediation command"; else fail "remediation command missing"; fi
rm -rf "$repo"

# --- 3. Drift is non-destructive: working tree restored after detection ------
repo="$(make_repo)"
run_gate "$repo" 'printf "\n  \"drift\": true\n" >> package-lock.json' >/dev/null
if (cd "$repo" && git diff --quiet -- package-lock.json); then
  pass "lockfile restored after drift (clean working tree)"
else
  fail "gate left the lockfile mutated"
fi
rm -rf "$repo"

# --- 4. Regen command itself fails → exit 1 with a clear error ----------------
repo="$(make_repo)"
res="$(run_gate "$repo" "false")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "regen failure fails (exit 1)"; else fail "regen failure should exit 1, got $rc"; fi
if echo "$out" | grep -qi "regeneration command failed"; then pass "regen failure has clear message"; else fail "regen failure message missing"; fi
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
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
