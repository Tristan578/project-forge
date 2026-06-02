#!/usr/bin/env bash
# Lockfile-drift gate — fail a PR when a package.json change was not accompanied
# by a regenerated root package-lock.json.
#
# This is a single-root-lockfile monorepo: ONE package-lock.json at the repo
# root governs web/, mcp-server/ and the root workspace. A Dependabot npm PR
# scoped to `directory: /web` (or a hand-edit) can bump web/package.json without
# touching the root lockfile; the manifest range then no longer matches the
# pinned lockfile version, and every `npm ci` (all of CI + the Quality Gates
# jobs run it) fails with EUSAGE on main. That regression shipped twice
# (#8655, #8658 → #8683) because `npm ci`'s own check only trips AFTER the bad
# state lands. This gate trips BEFORE merge: it regenerates the lockfile from
# the current manifests and fails if the result differs from what is committed.
#
# SECURITY: the regeneration command is overridable via $LOCKFILE_REGEN_CMD and
# run through `eval` purely as a TEST SEAM — the unit test
# (scripts/__tests__/check-lockfile-sync.test.sh) injects a stub so it can run
# hermetically without npm or the network. CI never sets the variable; it uses
# the default real `npm install --package-lock-only`. The value is therefore
# trusted (it originates from this repo's own workflow/test, never from PR
# contents or any untrusted input), so the `eval` carries no injection risk.
# Do NOT wire this variable to anything attacker-controllable.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || { echo "::error::could not cd to repo root"; exit 1; }

LOCKFILE="package-lock.json"
# Single-source the regeneration command so the human remediation hint printed on
# drift can never drift from what the gate actually runs. BASE_REGEN is the bare
# command a developer runs locally to fix drift; the CI default hardens it with
# --ignore-scripts (so a hostile package.json lifecycle script in a PR cannot
# execute during regeneration), --no-audit and --no-fund. $LOCKFILE_REGEN_CMD is a
# TEST-ONLY seam (see header) and is never set in CI, so the default is what runs.
BASE_REGEN='npm install --package-lock-only'
REGEN_CMD="${LOCKFILE_REGEN_CMD:-$BASE_REGEN --ignore-scripts --no-audit --no-fund}"

if [ ! -f "$LOCKFILE" ]; then
  echo "::error::$LOCKFILE not found at repo root ($ROOT)"
  exit 1
fi

# Regenerate the lockfile from the manifests only (no node_modules writes).
# Capture the command's own output so a real npm failure (registry 404, bad
# engines floor, malformed manifest) is surfaced in the gate log instead of
# being swallowed — a silent "regeneration command failed" is un-actionable.
regen_log="$(mktemp)"
# Clean up the tmpfile on EVERY exit path. The explicit TERM/INT handlers are not
# redundant with the EXIT trap: the regeneration is a multi-second `npm install`,
# and if CI cancels the job it sends SIGTERM mid-eval. On the Linux runner (bash
# 5.x) an EXIT trap does NOT run for an *untrapped* terminating signal, so without
# the TERM/INT handlers the tmpfile would leak exactly on cancellation; the
# handler's `exit` is what triggers the EXIT trap. (check-ci-success.sh uses an
# EXIT-only trap by contrast — its work is sub-second, so its signal window is
# negligible; here the long npm window makes the signal handlers worth the lines.)
trap 'rm -f "$regen_log"' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
if ! eval "$REGEN_CMD" >"$regen_log" 2>&1; then
  echo "::error::lockfile regeneration command failed: $REGEN_CMD"
  echo "--- regeneration command output ---"
  cat "$regen_log"
  echo "--- end regeneration command output ---"
  git checkout -- "$LOCKFILE" 2>/dev/null || true
  exit 1
fi

if git diff --quiet -- "$LOCKFILE"; then
  echo "✓ $LOCKFILE is in sync with the package manifests."
  exit 0
fi

# Drift: report with remediation, then restore the committed lockfile so the
# gate leaves no mutation behind (it is a check, not a fix).
echo "::error::Lockfile drift detected — $LOCKFILE does not match the package manifests."
echo ""
echo "A package.json was changed without regenerating the root lockfile. In this"
echo "single-root-lockfile monorepo a bump under web/ or mcp-server/ must also"
echo "update the root package-lock.json, or 'npm ci' breaks on main."
echo ""
echo "Fix: from the repo root, run"
echo "    $BASE_REGEN"
echo "then commit the updated package-lock.json."
echo ""
echo "Drift (first 40 lines):"
git --no-pager diff -- "$LOCKFILE" | head -40
git checkout -- "$LOCKFILE" 2>/dev/null || true
exit 1
