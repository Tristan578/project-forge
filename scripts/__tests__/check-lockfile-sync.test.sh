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
  # web/, mcp-server/) — not just the root — AND the root lockfile. Assert against
  # the LITERAL detection line (the one that sets deps=true), not the mere
  # presence of the tokens somewhere in the file: 'package.json' and 'deps=true'
  # both appear in dozens of unrelated places, so the old two-token check was a
  # tautology that would still pass even if the detection regex were gutted.
  deps_line="$(echo "$ci" | grep -F 'deps=true')"
  if echo "$deps_line" | grep -qF '(^|/)package\.json$' \
     && echo "$deps_line" | grep -qF '^package-lock\.json$'; then
    pass "ci-gate deps detection regex keys on package.json (any depth) + root lockfile"
  else
    fail "ci-gate deps=true line does not key on package.json/lockfile changes"
  fi

  # The ci-gate "No relevant changes — downstream jobs will be skipped" diagnostic
  # must account for `deps`. A manifest-only PR (e.g. a Dependabot web/ bump) sets
  # any_code=false, hooks=false, but deps=true — the lockfile-sync gate DOES run.
  # If the diagnostic's guard ignores deps it prints "downstream jobs will be
  # skipped" on exactly the PRs the gate is meant to catch, a misleading log that
  # invites a reader to assume nothing ran. Assert the guard keys on deps too. The
  # `if:` precedes the echo, so pull the line before the message.
  norel_if="$(echo "$ci" | awk '/No relevant changes — downstream jobs/{print prev} {prev=$0}')"
  if echo "$norel_if" | grep -qF 'deps'; then
    pass "ci-gate 'no relevant changes' diagnostic accounts for deps (manifest-only PRs)"
  else
    fail "ci-gate 'no relevant changes' guard ignores deps — mislabels manifest-only PRs as no-op"
  fi

  # Extract the whole lockfile-sync job block (header → next 2-space job header).
  # The awk start-condition '/^  lockfile-sync:/' requires ':' immediately after
  # 'lockfile-sync', so it fires ONLY on the exact '  lockfile-sync:' header — the
  # later '  lockfile-sync-tests:' header (a '-' sits where the ':' would be) does
  # NOT start a second block. The block then terminates at the exit guard, which
  # fires on the first following 2-space job header that is NOT '  lockfile-sync:'
  # — i.e. '  lockfile-sync-tests:'. (That header line is printed before the guard
  # exits, so it is ls_block's last line; the lockfile-sync-tests job body — incl.
  # its own if: — is not part of the block.)
  ls_block="$(echo "$ci" | awk '/^  lockfile-sync:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  lockfile-sync:/{exit}')"

  # Defense-in-depth against a constant-false unwiring. The job's `if:` MUST key
  # on `needs-deps == 'true'`. Why this matters as a SEPARATE check from the
  # ci-success anti-tamper: the anti-tamper only fires when needs-deps=true AND
  # the gate is skipped — it catches an `if: false` the moment a real drift PR
  # (which changes a manifest → needs-deps=true) arrives, but NOT the PR that
  # *introduces* the `if: false` if that PR touches no manifest (needs-deps=false
  # → the gate legitimately skips → anti-tamper stays quiet). That introducing PR
  # does edit ci.yml, though, so it sets needs-ci=true and runs THIS suite — and
  # this assertion catches the constant-false at introduction time, closing the
  # window the anti-tamper alone leaves open.
  ls_if="$(echo "$ls_block" | grep -E '^[[:space:]]+if:')"
  if echo "$ls_if" | grep -qF 'needs-deps' && echo "$ls_if" | grep -qF "== 'true'"; then
    pass "lockfile-sync job if: keys on needs-deps == 'true' (a constant if:false is caught here)"
  else
    fail "lockfile-sync job if: is not gated on needs-deps == 'true' (possible constant-false unwiring)"
  fi

  if echo "$ci" | grep -q 'check-lockfile-sync.sh'; then
    pass "lockfile-sync job runs scripts/check-lockfile-sync.sh"
  else
    fail "ci.yml never invokes the gate script"
  fi

  # SECURITY: $LOCKFILE_REGEN_CMD is a TEST-ONLY seam (the hermetic suite injects it
  # via run_gate). It must NEVER appear in an EXECUTABLE line of the real lockfile-sync
  # job. A PR that wired `env: LOCKFILE_REGEN_CMD: 'true'` into the job would make the
  # gate `eval 'true'` — a no-op: it regenerates nothing, `git diff --quiet` passes, and
  # the gate exits 0 "in sync" while real drift slips through. The ci-success anti-tamper
  # cannot catch this (the job result is `success`, not `skipped`, so the
  # skip-while-triggered check stays quiet). But a wiring PR edits ci.yml → needs-ci=true
  # → runs THIS suite, so this assertion fails that required check at introduction time,
  # closing the gap that otherwise leaves human review as the only defense.
  #
  # COMMENT-STRIP: the naive ls_block (job header → next job header) also captures the
  # doc-comment block that PRECEDES the lockfile-sync-tests: header — and that prose
  # legitimately names $LOCKFILE_REGEN_CMD ("injects a stub ..."). Strip full-comment
  # lines first so the check keys on real YAML/shell, not documentation; an attacker's
  # `env:` wiring is a non-comment line and is still caught.
  if echo "$ls_block" | grep -v '^[[:space:]]*#' | grep -q 'LOCKFILE_REGEN_CMD'; then
    fail "lockfile-sync job exposes the LOCKFILE_REGEN_CMD test seam in an executable line — gate can be no-op'd into a false pass"
  else
    pass "lockfile-sync job does not wire the LOCKFILE_REGEN_CMD test seam (gate cannot be bypassed via job env)"
  fi

  # ci-success's needs: list is the required-check surface. Pull the block from
  # 'ci-success:' to its steps: and assert lockfile-sync is one of its needs.
  # Anchor each match to the whole list entry ($) so '- lockfile-sync' cannot be
  # satisfied by the '- lockfile-sync-tests' entry (substring) and vice-versa.
  cisuccess_needs="$(echo "$ci" | awk '/^  ci-success:/{f=1} f{print} /^    steps:/{if(f)exit}')"
  if echo "$cisuccess_needs" | grep -qE '^      - lockfile-sync$'; then
    pass "ci-success requires the lockfile-sync job"
  else
    fail "lockfile-sync is not in ci-success needs — gate is not required"
  fi

  # The gate's OWN decision logic must be unit-tested by a REQUIRED check, not an
  # advisory one. A standalone path-filtered workflow can be left out of ci-success
  # (advisory), so a PR that neuters check-lockfile-sync.sh could merge even though
  # the suite fails. Pin the self-tests as a ci.yml job that rides ci-success — the
  # same pattern hook-tests uses — so unwiring the gate fails a REQUIRED check.
  if echo "$ci" | grep -qE '^  lockfile-sync-tests:'; then
    pass "ci.yml defines a lockfile-sync-tests job (gate self-tests are in the pipeline)"
  else
    fail "ci.yml has no lockfile-sync-tests job (gate self-tests are not in the required pipeline)"
  fi

  # Extract the whole lockfile-sync-tests job block (header → next job header) so
  # step assertions don't depend on a fixed grep -A window as steps are added.
  lst_block="$(echo "$ci" | awk '/^  lockfile-sync-tests:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  lockfile-sync-tests:/{exit}')"

  if echo "$lst_block" | grep -qF 'bash scripts/__tests__/check-lockfile-sync.test.sh'; then
    pass "lockfile-sync-tests job runs the lockfile gate's bash suite"
  else
    fail "lockfile-sync-tests job does not run the lockfile gate bash suite"
  fi

  # The self-tests job must be gated on a REAL trigger (needs-ci fires on scripts/
  # and .github/workflows/ changes), not pinned to a constant. A future `if: false`
  # would permanently skip the job; because ci-success tolerates skips, the LAST
  # line of defense is the anti-tamper check in check-ci-success.sh (pinned by its
  # own suite). Here we assert today's wiring keys on needs-ci.
  if echo "$lst_block" | grep -qE 'needs-ci|needs\.ci-gate\.outputs'; then
    pass "lockfile-sync-tests job is gated on needs-ci (a real path trigger, not a constant)"
  else
    fail "lockfile-sync-tests job is not gated on needs-ci"
  fi

  # The same job also runs the ci-success verifier's own suite — that is what pins
  # the anti-tamper logic. Assert the run step is present so it can't be dropped.
  if echo "$lst_block" | grep -qF 'bash scripts/__tests__/check-ci-success.test.sh'; then
    pass "lockfile-sync-tests job also runs the ci-success verifier suite"
  else
    fail "lockfile-sync-tests job does not run the ci-success verifier suite"
  fi

  if echo "$cisuccess_needs" | grep -qE '^      - lockfile-sync-tests$'; then
    pass "ci-success requires the lockfile-sync-tests job"
  else
    fail "lockfile-sync-tests is not in ci-success needs — gate self-tests are not required"
  fi

  # The ci-success verify step must call the EXTRACTED, unit-tested verifier
  # (check-ci-success.sh), not an inline jq. The script carries the anti-tamper
  # check; a skip-tolerant inline jq would silently re-open the `if: false`
  # unwiring vector. Pin the call site.
  cisuccess_block="$(echo "$ci" | awk '/^  ci-success:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  ci-success:/{exit}')"
  if echo "$cisuccess_block" | grep -qF 'bash scripts/check-ci-success.sh'; then
    pass "ci-success runs the extracted, unit-tested verifier (check-ci-success.sh)"
  else
    fail "ci-success no longer calls check-ci-success.sh — anti-tamper logic may be bypassed"
  fi
else
  fail "ci.yml not found at $CI_YML"
fi

echo ""
echo "=== gate script hardening (structural) ==="
# These pin properties of check-lockfile-sync.sh that are NOT observable as a
# portable runtime RED on this dev host, so we lock them structurally (each is
# mutation-provable: gut the property in the script and the matching case fails).
#
# WHY STRUCTURAL, NOT A SIGNAL RACE (regen_log cleanup): the gate captures npm's
# output to a mktemp file during a multi-second regeneration. If the job is
# cancelled (CI sends SIGTERM) mid-regen, that tmpfile must still be removed.
# macOS bash 3.2 (this host) DEFERS SIGTERM while waiting on a foreground child
# and then runs the fail-branch cleanup, so the leak simply does not reproduce
# here — only Linux bash 5.x (the CI runner), which does NOT run an EXIT trap on
# an *untrapped* SIGTERM, leaks. A behavioural signal test would therefore pass
# on macOS regardless of the fix (a fake green). We instead require the cleanup
# to be wired as an EXIT trap PLUS an explicit TERM/INT handler (the handler's
# `exit` is what makes the EXIT trap fire under Linux's signal semantics).

# #3 — regen_log is cleaned via an EXIT trap, not only an explicit happy-path rm.
if grep -Eq "trap .*rm -f .*regen_log.* EXIT" "$SCRIPT"; then
  pass "gate cleans up regen_log via an EXIT trap (covers early-exit / signal paths)"
else
  fail "gate has no EXIT trap for regen_log — a signal/early-exit between mktemp and cleanup leaks it"
fi

# #3 — the TERM (and INT) handler that forces the EXIT trap to run under Linux
# bash on CI cancellation. Without it the EXIT-only trap does NOT fire on an
# untrapped SIGTERM on the CI runner, so the tmpfile leaks exactly when it matters.
if grep -qF "trap 'exit 143' TERM" "$SCRIPT"; then
  pass "gate installs a TERM handler so the EXIT trap fires on CI cancellation (Linux bash)"
else
  fail "gate has no TERM handler — Linux bash won't run the EXIT trap on SIGTERM, leaking regen_log"
fi

# #3 — the matching INT (SIGINT / Ctrl-C) handler. The comment above and the gate
# itself treat TERM and INT as a pair (both force the EXIT trap to run under Linux's
# untrapped-signal semantics); assert INT too so a future edit cannot drop it while
# the TERM assertion alone stays green. Mutation-provable like the TERM check.
if grep -qF "trap 'exit 130' INT" "$SCRIPT"; then
  pass "gate installs an INT handler so the EXIT trap fires on interactive cancellation"
else
  fail "gate has no INT handler — the EXIT trap won't fire on an untrapped SIGINT, leaking regen_log"
fi

# #4 — SECURITY invariant: the DEFAULT regeneration command runs with
# --ignore-scripts so a hostile package.json lifecycle script in a PR cannot
# execute during CI lockfile regeneration. ($LOCKFILE_REGEN_CMD is a test-only
# seam, never set in CI, so the default is what actually runs.)
if grep -E '^(REGEN_CMD|BASE_REGEN)=' "$SCRIPT" | grep -q -- '--ignore-scripts'; then
  pass "default regen command runs with --ignore-scripts (no PR lifecycle scripts in CI)"
else
  fail "default regen command is missing --ignore-scripts — a PR package.json script could run in CI"
fi

# #5 — the human remediation hint and the actual regen command single-source from
# $BASE_REGEN, so the "Fix: run ..." line printed to a developer cannot drift from
# the command the gate itself runs.
if grep -qE '^BASE_REGEN=' "$SCRIPT"; then
  pass "gate defines a single-sourced BASE_REGEN"
else
  fail "gate has no BASE_REGEN — remediation hint and regen command can drift apart"
fi
# SC2016: the single quotes are intentional — we assert the LITERAL token
# '$BASE_REGEN' appears in the script source (i.e. the echo references the
# variable rather than hardcoding the command), so it must NOT be expanded here.
# shellcheck disable=SC2016
if grep -A2 'Fix: from the repo root' "$SCRIPT" | grep -qF '$BASE_REGEN'; then
  pass "remediation hint echoes \$BASE_REGEN (single-sourced, cannot drift)"
else
  fail "remediation hint hardcodes the command instead of \$BASE_REGEN"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
