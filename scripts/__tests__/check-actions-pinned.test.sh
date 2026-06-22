#!/usr/bin/env bash
# Unit tests for scripts/check-actions-pinned.sh — the GitHub Actions SHA-pin
# gate — plus a structural assertion that the gate AND its suite are wired into
# ci.yml's required `lockfile-sync-tests` ("CI Self-Defense Tests") job.
#
# WHY THIS GATE EXISTS
# --------------------
# A hand-written workflow that pins a third- or first-party action by a mutable
# tag/branch ref (e.g. `actions/checkout@v6`) lets a compromised or maliciously
# re-tagged upstream action execute in CI with the repository token — secret
# exfiltration or build tampering (audit finding F35, #8627). The gate fails the
# PR unless every action is pinned to a 40-hex commit SHA. An untested exit-code
# regression here would silently re-open that hole, so the gate is tested like
# any other CI self-defense gate.
#
# HERMETIC TESTING
# ----------------
# The gate resolves its repo root from its own location
# ($(dirname BASH_SOURCE)/..) and scans `.github/workflows/*.yml` relative to it
# — there is no env seam. So each case builds a throwaway repo, COPIES the real
# gate into <repo>/scripts/, and runs THAT copy: its repo_root then resolves to
# the throwaway tree. The gate uses only grep/sed — no node, no network, and it
# mutates nothing outside the temp dir.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../check-actions-pinned.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
FAILURES=0

# A real 40-hex commit SHA shape (immutable pin). Forty lowercase hex chars.
SHA40="0123456789abcdef0123456789abcdef01234567"

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "gate script not found: $SCRIPT"; exit 1; }

# Build a throwaway repo with a copy of the real gate at <repo>/scripts/ and an
# empty .github/workflows/. Echoes the repo path; the caller writes *.yml
# fixtures into <repo>/.github/workflows/. No `git init` needed — the gate uses
# no git.
make_repo() {
  local repo
  repo="$(mktemp -d)"
  mkdir -p "$repo/scripts" "$repo/.github/workflows"
  cp "$SCRIPT" "$repo/scripts/check-actions-pinned.sh"
  echo "$repo"
}

# write_wf <repo> <filename> <contents...> — write .github/workflows/<filename>.
write_wf() { printf '%s' "$3" > "$1/.github/workflows/$2"; }

# Run the gate inside <repo>; echo "<exit>|<output>".
run_gate() {
  local repo="$1" out rc
  out="$(bash "$repo/scripts/check-actions-pinned.sh" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

echo "=== check-actions-pinned.sh tests ==="

# --- 1. Fully SHA-pinned workflow -> exit 0 + success message -----------------
repo="$(make_repo)"
write_wf "$repo" ci.yml "jobs:
  build:
    steps:
      - uses: actions/checkout@$SHA40 # v4
      - uses: actions/setup-node@$SHA40 # v4
"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "fully SHA-pinned workflow passes (exit 0)"; else fail "SHA-pinned should exit 0, got $rc ($out)"; fi
if grep -qi "SHA-pinned" <<<"$out"; then pass "success message names the verdict"; else fail "success message missing"; fi
rm -rf "$repo"

# --- 2. Mutable tag ref (@v6) -> exit 1, names the ref + ::error annotation ---
repo="$(make_repo)"
write_wf "$repo" ci.yml "jobs:
  build:
    steps:
      - uses: actions/checkout@v6
"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "mutable tag @v6 fails (exit 1)"; else fail "mutable tag should exit 1, got $rc"; fi
if grep -qF 'actions/checkout@v6' <<<"$out"; then pass "failure names the offending ref"; else fail "failure does not name the ref"; fi
if grep -qF '::error file=' <<<"$out"; then pass "failure emits an ::error file= annotation"; else fail "no ::error file= annotation"; fi
rm -rf "$repo"

# --- 3. Branch ref (@main) -> exit 1 -----------------------------------------
# A branch name is as mutable as a tag — must be rejected too.
repo="$(make_repo)"
write_wf "$repo" ci.yml "jobs:
  build:
    steps:
      - uses: dtolnay/rust-toolchain@main
"
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "1" ]; then pass "branch ref @main fails (exit 1)"; else fail "branch ref should exit 1, got $rc"; fi
rm -rf "$repo"

# --- 4. Short SHA (7-hex) -> exit 1 ------------------------------------------
# Only a full 40-hex SHA is immutable; an abbreviated SHA must be rejected.
repo="$(make_repo)"
write_wf "$repo" ci.yml "jobs:
  build:
    steps:
      - uses: actions/checkout@abc1234
"
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "1" ]; then pass "abbreviated 7-hex SHA fails (exit 1)"; else fail "short SHA should exit 1, got $rc"; fi
rm -rf "$repo"

# --- 5. Generated *.lock.yml with a mutable ref -> ignored (exit 0) ----------
# gh-aw lock files inject their own SHA pins and are guarded by
# check-ghaw-lock-sync.sh; this gate must skip them even when they carry a tag.
repo="$(make_repo)"
write_wf "$repo" agent.lock.yml "jobs:
  build:
    steps:
      - uses: actions/setup-node@v4
"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "*.lock.yml mutable ref is ignored (exit 0)"; else fail "*.lock.yml should be skipped, got $rc ($out)"; fi
rm -rf "$repo"

# --- 6. Local composite (./...) and docker:// refs -> skipped (exit 0) -------
# Neither is tag-pinnable, so neither should trip the gate.
repo="$(make_repo)"
write_wf "$repo" ci.yml "jobs:
  build:
    steps:
      - uses: ./.github/actions/setup
      - uses: docker://alpine:3.20
"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "local ./ + docker:// refs are skipped (exit 0)"; else fail "local/docker refs should pass, got $rc ($out)"; fi
rm -rf "$repo"

# --- 7. SHA pin with a trailing '# vX' comment -> exit 0 ---------------------
# Dependabot writes `uses: owner/action@<sha> # v4`; the comment must be stripped
# before the SHA is validated, not treated as part of the ref.
repo="$(make_repo)"
write_wf "$repo" ci.yml "jobs:
  build:
    steps:
      - uses: actions/upload-artifact@$SHA40 # v4.4.0
"
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "SHA pin with trailing version comment passes (exit 0)"; else fail "SHA + comment should exit 0, got $rc"; fi
rm -rf "$repo"

# --- 8. One clean + one offending workflow -> exit 1 (offender wins) ---------
# A clean file must not mask a sibling that pins by tag; the gate scans all.
repo="$(make_repo)"
write_wf "$repo" clean.yml "jobs:
  a:
    steps:
      - uses: actions/checkout@$SHA40 # v4
"
write_wf "$repo" dirty.yml "jobs:
  b:
    steps:
      - uses: actions/setup-node@v4
"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "an offending workflow alongside a clean one still fails (exit 1)"; else fail "mixed clean/dirty should exit 1, got $rc"; fi
if grep -qF 'setup-node@v4' <<<"$out"; then pass "the offending sibling is named in the failure"; else fail "offending sibling not reported"; fi
rm -rf "$repo"

# --- 9. No workflows at all -> exit 0 (nullglob no-op) ------------------------
repo="$(make_repo)"
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "empty .github/workflows/ passes (exit 0)"; else fail "no workflows should exit 0, got $rc"; fi
rm -rf "$repo"

echo ""
echo "=== ci.yml integration wiring ==="
# Every other check-*.sh gate's suite runs in the lockfile-sync-tests ("CI
# Self-Defense Tests") job, which rides ci-success and so is REQUIRED. Pin that
# this gate AND its suite are shellchecked there, and that the suite is executed,
# so a future edit cannot silently demote either to advisory-only.
if [ -f "$CI_YML" ]; then
  lst_block="$(awk '/^  lockfile-sync-tests:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  lockfile-sync-tests:/{exit}' "$CI_YML")"
  if grep -qF 'scripts/check-actions-pinned.sh' <<<"$lst_block" \
     && grep -qF 'scripts/__tests__/check-actions-pinned.test.sh' <<<"$lst_block"; then
    pass "lockfile-sync-tests shellchecks the gate + its suite"
  else
    fail "lockfile-sync-tests does not shellcheck check-actions-pinned.sh + its test"
  fi
  if grep -qF 'bash scripts/__tests__/check-actions-pinned.test.sh' <<<"$lst_block"; then
    pass "lockfile-sync-tests runs the actions-pinned gate suite"
  else
    fail "lockfile-sync-tests does not run the actions-pinned gate suite (self-tests not required)"
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
