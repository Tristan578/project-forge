#!/usr/bin/env bash
# Unit tests for scripts/check-ghaw-lock-sync.sh — the gh-aw lock-drift gate —
# plus structural assertions that the gate is wired into ci.yml's required
# `ci-success` aggregate (a standalone path-filtered workflow can never be a
# safe required check, so the gate has to ride the existing ci-gate/ci-success
# pattern instead).
#
# WHY THIS GATE EXISTS
# --------------------
# GitHub Agentic Workflows (gh-aw) compiles every author-edited
# `.github/workflows/*.md` source into a generated sibling `*.lock.yml`
# ("DO NOT EDIT … run gh aw compile"), injecting SHA-pinned action refs from
# `.github/aw/actions-lock.json`. Editing a `.md` source, or the action pins,
# WITHOUT re-running `gh aw compile` leaves the committed `.lock.yml` stale —
# the compiled workflow GitHub actually runs no longer matches its source. This
# is the same silent drift the Lockfile Sync gate closes for package-lock.json,
# and the parity review flagged it live (committed locks referenced setup@v0.65.0
# while actions-lock.json pinned v0.53.1). The contributor most likely to hit it
# is a non-Claude one who edits a `.md` and never learns `gh aw compile` exists.
# This gate fires BEFORE merge, deterministically, instead of after.
#
# HERMETIC TESTING
# ----------------
# The gate's real reconciliation step (`gh aw compile`) needs the gh-aw extension
# installed and is environment-sensitive, so the script reads the compile command
# from $GHAW_COMPILE_CMD. These tests inject a stub command that simulates the
# outcomes (no-op = in sync, mutate a lock = drift, create a new lock = an
# uncompiled new source, partial-write+fail) in a throwaway git repo. The real
# `gh aw compile` invocation is exercised by CI (which installs the pinned
# toolchain), not here — these tests pin the branching/exit-code/messaging contract.
set -uo pipefail

# SIGPIPE-safe matching: feed grep/awk from a here-string — `grep PAT <<<"$var"`
# — and never pipe a large variable's `echo` output into grep/awk. Under
# `pipefail`, `grep -q` closes the pipe on its FIRST match; on a payload larger
# than the runner's pipe buffer (e.g. the ~31 KB ci.yml read below) the
# still-writing `echo` then takes SIGPIPE, which `pipefail` turns into a non-zero
# pipeline status — silently converting a real match into a false "missing"
# failure. That bit CI on the integration-wiring assertions of the sibling
# lockfile suite. The structural guard at the end of this file keeps the
# antipattern from creeping back in.

# Host-dependency guard: every fixture builds a throwaway git repo, so a stripped
# image missing git would otherwise fail ~all assertions with confusing cd errors
# that never name the real cause. Fail loudly and early instead (matches the jq
# guard in the sibling check-ci-success.test.sh).
command -v git >/dev/null 2>&1 || { echo "git is required for these tests"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../check-ghaw-lock-sync.sh"
HELPER="$HERE/../get-ghaw-compiler-version.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "gate script not found: $SCRIPT"; exit 1; }
[ -f "$HELPER" ] || { echo "compiler-version helper not found: $HELPER"; exit 1; }

# Build a throwaway git repo modelling a gh-aw layout: one .md source, its
# committed .lock.yml, and the action-pin manifest. Echoes the repo path. Caller
# is responsible for rm -rf.
make_ghaw_repo() {
  local repo
  repo="$(mktemp -d)"
  (
    cd "$repo" || exit 1
    git init -q
    git config user.email t@t.t
    git config user.name t
    mkdir -p .github/workflows .github/aw
    printf '# demo source\nname: demo\non: push\n' > .github/workflows/demo.md
    printf '# gh-aw-metadata: {"compiler_version":"v0.53.1"}\nname: demo\non: push\njobs: {}\n' > .github/workflows/demo.lock.yml
    printf '{\n  "entries": {}\n}\n' > .github/aw/actions-lock.json
    git add -A
    git commit -qm init
  )
  echo "$repo"
}

# Run the gate inside $repo with a given compile stub; echo "<exit>|<output>".
run_gate() {
  local repo="$1" cmd="$2" out rc
  out="$(cd "$repo" && GHAW_COMPILE_CMD="$cmd" bash "$SCRIPT" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

# True iff the working tree under .github/workflows/ is clean (no modified,
# deleted, or untracked files). Used to prove drift detection is non-destructive.
workflows_clean() {
  local repo="$1"
  [ -z "$(cd "$repo" && git status --porcelain -- .github/workflows/)" ]
}

echo "=== check-ghaw-lock-sync.sh tests ==="

# --- 1. In sync: compile is a no-op → exit 0 + success message ---------------
repo="$(make_ghaw_repo)"
res="$(run_gate "$repo" "true")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "in-sync locks pass (exit 0)"; else fail "in-sync should exit 0, got $rc"; fi
if grep -qi "in sync" <<<"$out"; then pass "in-sync prints a success message"; else fail "in-sync success message missing"; fi
rm -rf "$repo"

# --- 2. Drift: compile mutates a committed lock → exit 1 + drift message ------
repo="$(make_ghaw_repo)"
res="$(run_gate "$repo" 'printf "\n# drift\n" >> .github/workflows/demo.lock.yml')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "drift (modified lock) fails (exit 1)"; else fail "drift should exit 1, got $rc"; fi
if grep -qi "drift detected" <<<"$out"; then pass "drift prints 'drift detected'"; else fail "drift message missing"; fi
if grep -q "gh aw compile" <<<"$out"; then pass "drift prints the remediation command"; else fail "remediation command missing"; fi
rm -rf "$repo"

# --- 3. Drift is non-destructive: gate exits 1 AND restores the working tree -
# Assert BOTH the exit code and the clean tree — a gate that silently passed on
# drift (rc 0) would still leave a clean tree, so the tree check alone is not
# enough to prove drift was detected.
repo="$(make_ghaw_repo)"
res="$(run_gate "$repo" 'printf "\n# drift\n" >> .github/workflows/demo.lock.yml')"
rc="${res%%|*}"
if [ "$rc" = "1" ]; then pass "drift detection returns exit 1 (non-destructive case)"; else fail "drift should exit 1, got $rc"; fi
if workflows_clean "$repo"; then
  pass "modified lock restored after drift (clean working tree)"
else
  fail "gate left the lock file mutated"
fi
rm -rf "$repo"

# --- 4. Drift via an UNCOMPILED NEW SOURCE: compile emits a NEW untracked -----
#        .lock.yml → exit 1, and the untracked lock is cleaned up afterward.
# This is the vector `git diff --quiet` (tracked-only) MISSES: a contributor adds
# newflow.md and never runs `gh aw compile`, so newflow.lock.yml is absent from
# the commit. The gate must detect the freshly-produced untracked lock as drift
# (it uses `git status --porcelain`, which sees untracked files), AND must remove
# it on restore so a local run does not litter the tree.
repo="$(make_ghaw_repo)"
res="$(run_gate "$repo" 'printf "name: newflow\n" > .github/workflows/newflow.lock.yml')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "drift (new untracked lock) fails (exit 1)"; else fail "new-untracked-lock drift should exit 1, got $rc"; fi
if grep -qi "drift detected" <<<"$out"; then pass "new-untracked-lock drift prints 'drift detected'"; else fail "new-untracked-lock drift message missing"; fi
if workflows_clean "$repo"; then
  pass "untracked lock removed after drift (clean working tree)"
else
  fail "gate left a newly-created untracked lock file behind"
fi
rm -rf "$repo"

# --- 5. Compile command itself fails → exit 1, clear message, surfaced output,
#        AND a partial write is rolled back ----------------------------------
# The stub writes a partial mutation and THEN fails, so this exercises the
# compile-failure restore branch (git checkout / clean) that a `false`-only stub
# leaves untouched. It also emits a diagnostic on stderr that the gate MUST
# surface — silencing gh-aw's real error turns an actionable failure into a
# cryptic one.
#
# The marker is ASSEMBLED at runtime ($(printf MARKER)) so the literal command
# string the gate echoes can never itself contain the resolved "COMPILE_DIAG_MARKER"
# — the assertion below therefore only passes if the gate genuinely captured and
# surfaced the command's own stderr, not merely re-printed the command it ran.
repo="$(make_ghaw_repo)"
# SC2016: the $(printf MARKER) is intentionally NOT expanded by this shell — the
# stub string is passed verbatim to the gate, which evals it. Resolving it here
# would defeat the test (see the marker-assembly note above).
# shellcheck disable=SC2016
res="$(run_gate "$repo" 'printf "\n# partial\n" >> .github/workflows/demo.lock.yml; printf "COMPILE_DIAG_%s\n" "$(printf MARKER)" >&2; false')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "compile failure fails (exit 1)"; else fail "compile failure should exit 1, got $rc"; fi
if grep -qi "compile command failed" <<<"$out"; then pass "compile failure has clear message"; else fail "compile failure message missing"; fi
if grep -q "COMPILE_DIAG_MARKER" <<<"$out"; then pass "compile failure surfaces the command's own output"; else fail "compile failure swallowed the underlying diagnostic"; fi
if workflows_clean "$repo"; then
  pass "partial write rolled back on compile failure (clean working tree)"
else
  fail "gate left a partial lock write after compile failure"
fi
rm -rf "$repo"

# --- 6. No gh-aw workflows present → exit 0 (nothing to reconcile) ------------
# A repo that does not use gh-aw (no .md sources AND no .lock.yml) has nothing to
# guard — the gate must pass WITHOUT invoking the compiler at all. The stub is
# `false`: if the gate ran it, the gate would exit 1. Exit 0 therefore proves the
# early-exit precedes the compile command (so CI never pointlessly installs/runs
# gh-aw on a repo with no agentic workflows).
repo="$(mktemp -d)"
( cd "$repo" && git init -q && git config user.email t@t.t && git config user.name t \
    && mkdir -p .github/workflows && printf '{}' > package.json && git add -A && git commit -qm init )
res="$(run_gate "$repo" "false")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "no gh-aw workflows passes without compiling (exit 0)"; else fail "no-workflows should exit 0, got $rc"; fi
if grep -qi "no .*workflows\|no gh-aw" <<<"$out"; then pass "no-workflows has a clear message"; else fail "no-workflows message missing"; fi
rm -rf "$repo"

# --- 7. Drift via an ORPHAN LOCK: a committed .lock.yml whose .md source was
#        deleted → `gh aw compile --purge` removes the orphan → exit 1, and the
#        deleted TRACKED lock is restored afterward. -----------------------------
# This is drift vector 3 — the one --purge exists to close. A contributor deletes
# a workflow's .md source but leaves its .lock.yml committed; the real compiler's
# --purge deletes the now-orphan lock. The stub simulates exactly that by removing
# the committed lock. The gate must (a) see the tracked deletion as drift
# (`git status --porcelain` shows ` D …lock.yml`, which the `\.lock\.yml$` matcher
# catches), exit 1, and (b) restore the deleted tracked file on cleanup
# (`git checkout` revives it), proving the check left no mutation. A `git diff
# --quiet`-style detector keyed only on MODIFIED content would miss a pure
# deletion — this case pins that the porcelain-status approach catches it.
repo="$(make_ghaw_repo)"
res="$(run_gate "$repo" 'rm .github/workflows/demo.lock.yml')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "drift (orphan lock purged) fails (exit 1)"; else fail "orphan-lock drift should exit 1, got $rc"; fi
if grep -qi "drift detected" <<<"$out"; then pass "orphan-lock drift prints 'drift detected'"; else fail "orphan-lock drift message missing"; fi
if workflows_clean "$repo"; then
  pass "deleted tracked lock restored after orphan-purge drift (clean working tree)"
else
  fail "gate left the purged tracked lock deleted"
fi
rm -rf "$repo"

# --- 7.5 Restore is SCOPED to the locks the compile touched — it must NOT revert
#         an unrelated, pre-existing uncommitted edit elsewhere under
#         .github/workflows/. -------------------------------------------------------
# restore_tree now fires from the EXIT trap on EVERY path (so signal cancellation
# can't leave the recompiled tree behind), INCLUDING the happy in-sync path. A
# restore that did `git checkout -- .github/workflows/` wholesale would, on that
# always-taken path, clobber any in-flight edit a developer has to a NON-generated
# file in that dir (e.g. ci.yml itself). The gate is "a check, not a fix": it may
# only undo what IT changed (the compiled locks), never the contributor's own
# uncommitted work. Set up an unrelated tracked workflow with a local uncommitted
# edit, run the happy path (no-op compile = in sync), and assert the edit survives.
repo="$(make_ghaw_repo)"
( cd "$repo" \
    && printf 'name: unrelated\non: push\njobs: {}\n' > .github/workflows/unrelated.yml \
    && git add -A && git commit -qm 'add unrelated non-lock workflow' \
    && printf 'name: unrelated\non: push\njobs: {}\n# local uncommitted edit\n' > .github/workflows/unrelated.yml )
res="$(run_gate "$repo" "true")"
rc="${res%%|*}"
edit_survived=no
grep -q 'local uncommitted edit' "$repo/.github/workflows/unrelated.yml" 2>/dev/null && edit_survived=yes
if [ "$rc" = "0" ] && [ "$edit_survived" = "yes" ]; then
  pass "gate preserves an unrelated uncommitted .github/workflows/ edit (restores only the compiled locks)"
else
  fail "gate clobbered an unrelated uncommitted workflow edit (rc=$rc, survived=$edit_survived) — restore_tree reverts the whole dir, not just locks"
fi
rm -rf "$repo"

# --- 7.6 Restore preserves a PRE-EXISTING untracked lock — it removes only the
#         untracked locks the COMPILE created, never one the developer already had.
#         (Exercises the BEFORE_UNTRACKED snapshot + its grep -Fxq guard.) ----------
# The gate snapshots untracked *.lock.yml BEFORE compiling so restore_tree's
# untracked-removal loop can skip them. Without this case the guard is dead from a
# testing standpoint: deleting `if ! grep -Fxq -- "$f" <<<"$BEFORE_UNTRACKED"` (so
# restore rm -f's EVERY untracked lock) would still pass every other case, yet
# would destroy a developer's uncommitted lock. Stage a pre-existing untracked lock,
# drive the drift path (which always invokes restore), and assert it survives.
repo="$(make_ghaw_repo)"
printf 'name: pre\non: push\njobs: {}\n' > "$repo/.github/workflows/pre.lock.yml"   # untracked, present BEFORE the gate
res="$(run_gate "$repo" 'printf "\n# drift\n" >> .github/workflows/demo.lock.yml')"
rc="${res%%|*}"
preexisting_survived=no
[ -f "$repo/.github/workflows/pre.lock.yml" ] && preexisting_survived=yes
if [ "$rc" = "1" ] && [ "$preexisting_survived" = "yes" ]; then
  pass "restore preserves a pre-existing untracked lock (BEFORE_UNTRACKED guard works)"
else
  fail "gate deleted a pre-existing untracked lock (rc=$rc, survived=$preexisting_survived) — BEFORE_UNTRACKED guard broken"
fi
rm -rf "$repo"

echo ""
echo "=== version-pin helper (scripts/get-ghaw-compiler-version.sh) ==="
# The helper derives the gh-aw compiler version the CI install step pins to, from
# the committed locks' `# gh-aw-metadata: {"compiler_version":"vX.Y.Z"}` headers.
# These cases pin its contract directly — the logic used to be inline in ci.yml
# where this suite could not reach it, and an inline `sort -u | head -1` picked
# the LEXICOGRAPHICALLY-smallest (older) version on disagreement, false-failing
# the gate by recompiling with the wrong compiler. Exercised here so a regression
# in the regex / sort order / fallback fails a required check instead of shipping.
run_helper() {
  local repo="$1" out rc
  out="$(cd "$repo" && bash "$HELPER" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

# 8a. Single committed lock recording a version → that version, verbatim.
repo="$(make_ghaw_repo)"
res="$(run_helper "$repo")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ] && [ "$out" = "v0.53.1" ]; then pass "helper emits the single lock's compiler_version"; else fail "helper single-lock expected 'v0.53.1' (rc 0), got '$out' (rc $rc)"; fi
rm -rf "$repo"

# 8b. Two locks disagree {v0.51.0, v0.53.1} → the HIGHEST in SEMVER order. This is
# the regression guard: lexicographic `head -1` would return v0.51.0 (older); the
# helper's `sort -Vu | tail -1` must return v0.53.1.
repo="$(make_ghaw_repo)"
( cd "$repo" \
    && printf '# gh-aw-metadata: {"compiler_version":"v0.51.0"}\nname: other\non: push\njobs: {}\n' > .github/workflows/other.lock.yml \
    && git add -A && git commit -qm 'add older-pinned lock' )
res="$(run_helper "$repo")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ] && [ "$out" = "v0.53.1" ]; then pass "helper picks the highest SEMVER version across disagreeing locks (not lexicographic)"; else fail "helper multi-lock expected 'v0.53.1', got '$out' (rc $rc) — lexicographic sort bug?"; fi
rm -rf "$repo"

# 8c. A lock with NO compiler_version metadata → fall back to the known-good pin.
repo="$(mktemp -d)"
( cd "$repo" && git init -q && git config user.email t@t.t && git config user.name t \
    && mkdir -p .github/workflows \
    && printf 'name: nometa\non: push\njobs: {}\n' > .github/workflows/nometa.lock.yml \
    && git add -A && git commit -qm init )
res="$(run_helper "$repo")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ] && [ -n "$out" ] && grep -qE '^v[0-9.]+$' <<<"$out"; then pass "helper falls back to a known-good version when no lock records one"; else fail "helper no-metadata fallback expected a vX.Y.Z fallback, got '$out' (rc $rc)"; fi
rm -rf "$repo"

# 8d. No locks at all → fall back (helper must never emit empty, which would pin
# `gh extension install …@` to nothing and break the install step).
repo="$(mktemp -d)"
( cd "$repo" && git init -q && git config user.email t@t.t && git config user.name t \
    && mkdir -p .github/workflows && printf '{}' > package.json && git add -A && git commit -qm init )
res="$(run_helper "$repo")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ] && grep -qE '^v[0-9.]+$' <<<"$out"; then pass "helper emits a non-empty fallback when there are no locks"; else fail "helper no-locks expected a vX.Y.Z fallback, got '$out' (rc $rc)"; fi
rm -rf "$repo"

# 8e. SILENT-FAILURE GUARD: when locks DO record version(s) but the available
# `sort` cannot rank them (e.g. an old build without -V, which exits non-zero),
# the helper MUST fail loudly — never silently emit the fallback. A silent
# fallback would pin the toolchain to the wrong compiler while reporting success,
# masking exactly the skew this gate exists to catch. The Seer flagged this on
# #8698: its literal premise ("sort -V unsupported on macOS") is inaccurate for
# modern macOS (Apple sort 2.3+ supports -V), but the silent-fallback-on-sort-
# failure mode it pointed at was real. Simulate by shadowing `sort` with a stub
# that exits non-zero, in a repo recording v0.99.0 (≠ the v0.81.6 fallback) so a
# silent fallback is unambiguously the WRONG answer, not a coincidental match.
repo="$(mktemp -d)"
( cd "$repo" && git init -q && git config user.email t@t.t && git config user.name t \
    && mkdir -p .github/workflows \
    && printf '# gh-aw-metadata: {"compiler_version":"v0.99.0"}\nname: hi\non: push\njobs: {}\n' > .github/workflows/hi.lock.yml \
    && git add -A && git commit -qm init )
stubdir="$(mktemp -d)"
printf '#!/usr/bin/env bash\nexit 2\n' > "$stubdir/sort"
chmod +x "$stubdir/sort"
out="$(cd "$repo" && PATH="$stubdir:$PATH" bash "$HELPER" 2>&1)"; rc=$?
if [ "$rc" != "0" ]; then pass "helper fails loudly when sort cannot rank recorded versions (no silent fallback)"; else fail "helper silently emitted '$out' (rc $rc) on sort failure — masks toolchain skew"; fi
if printf '%s' "$out" | grep -qiE 'error|could not|unable|refus'; then pass "the sort-failure error is surfaced, not swallowed"; else fail "no error surfaced on sort failure, got '$out' (rc $rc)"; fi
rm -rf "$repo" "$stubdir"

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

  if grep -qE '^  ghaw-lock-sync:' <<<"$ci"; then
    pass "ci.yml defines a ghaw-lock-sync job"
  else
    fail "ci.yml has no ghaw-lock-sync job (gate is not in the required pipeline)"
  fi

  if grep -qE 'needs-ghaw:' <<<"$ci"; then
    pass "ci-gate exposes a needs-ghaw output"
  else
    fail "ci-gate has no needs-ghaw output to gate the gh-aw job on"
  fi

  # The detector must key on the gh-aw SURFACES — the .md sources, their compiled
  # .lock.yml, AND the action-pin manifest under .github/aw/ — not just one of
  # them: an actions-lock.json bump with no .md edit still drifts the locks.
  # Assert against the LITERAL detection line (the one that sets ghaw=true), not
  # the mere presence of the tokens somewhere in the file.
  ghaw_line="$(grep -F 'ghaw=true' <<<"$ci")"
  if grep -qF 'lock\.yml' <<<"$ghaw_line" && grep -qF '.github/aw/' <<<"$ghaw_line"; then
    pass "ci-gate ghaw detection regex keys on .lock.yml + .github/aw/ pins"
  else
    fail "ci-gate ghaw=true line does not key on the .lock.yml / action-pin surfaces"
  fi

  # Extract the whole ghaw-lock-sync job block (header → next 2-space job header).
  # The awk start-condition '/^  ghaw-lock-sync:/' fires ONLY on the exact header;
  # the block terminates at the first following 2-space job header that is NOT
  # '  ghaw-lock-sync:'.
  ghaw_block="$(awk '/^  ghaw-lock-sync:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  ghaw-lock-sync:/{exit}' <<<"$ci")"

  # Defense-in-depth against a constant-false unwiring. The job's `if:` MUST key
  # on `needs-ghaw == 'true'`. Why this matters as a SEPARATE check from the
  # ci-success anti-tamper: the anti-tamper only fires when needs-ghaw=true AND
  # the gate is skipped — it catches an `if: false` the moment a real drift PR
  # (which edits a .md/lock/pin → needs-ghaw=true) arrives, but NOT the PR that
  # *introduces* the `if: false` if that PR touches no gh-aw surface. That
  # introducing PR does edit ci.yml, though, so it sets needs-ci=true and runs
  # THIS suite — and this assertion catches the constant-false at introduction.
  ghaw_if="$(grep -E '^[[:space:]]+if:' <<<"$ghaw_block")"
  if grep -qF 'needs-ghaw' <<<"$ghaw_if" && grep -qF "== 'true'" <<<"$ghaw_if"; then
    pass "ghaw-lock-sync job if: keys on needs-ghaw == 'true' (a constant if:false is caught here)"
  else
    fail "ghaw-lock-sync job if: is not gated on needs-ghaw == 'true' (possible constant-false unwiring)"
  fi

  # Scope this to the EXTRACTED job block, not the whole ci.yml: the script name
  # also appears in the self-defense job's comment + shellcheck list, so a broad
  # `<<<"$ci"` match would still PASS if the actual `run: bash …` line were
  # deleted from THIS job while a comment elsewhere kept the token alive — a
  # false green with the gate no longer invoked.
  if grep -qF 'run: bash scripts/check-ghaw-lock-sync.sh' <<<"$ghaw_block"; then
    pass "ghaw-lock-sync job runs scripts/check-ghaw-lock-sync.sh"
  else
    fail "ghaw-lock-sync job block never invokes the gate script via run:"
  fi

  # The job genuinely needs the real compiler, so it must install the gh-aw
  # extension PINNED to a version (not floating @latest, which would recompile to
  # different output and false-fail this gate on drift the contributor never
  # introduced). Assert the install step is present and pinned.
  if grep -qF 'gh extension install' <<<"$ghaw_block" && grep -qE -- '--pin' <<<"$ghaw_block"; then
    pass "ghaw-lock-sync job installs the gh-aw extension PINNED to a version"
  else
    fail "ghaw-lock-sync job does not install a pinned gh-aw (floating @latest would false-fail on compiler skew)"
  fi

  # The pin version MUST be derived via the standalone, unit-tested helper, not an
  # inline `grep … | sort … | head` pipeline buried in the job (which the gate-
  # family suite cannot reach — a sort-order or regex regression there would ship
  # green). Pin that the job calls the helper so it cannot regress back to inline.
  if grep -qF 'get-ghaw-compiler-version.sh' <<<"$ghaw_block"; then
    pass "ghaw-lock-sync job derives the pin via the testable helper (not inline)"
  else
    fail "ghaw-lock-sync job does not use scripts/get-ghaw-compiler-version.sh — pin logic is untestable inline"
  fi

  # SECURITY: $GHAW_COMPILE_CMD is a TEST-ONLY seam (the hermetic suite injects it
  # via run_gate). It must NEVER appear in an EXECUTABLE line of the real
  # ghaw-lock-sync job. A PR that wired `env: GHAW_COMPILE_CMD: 'true'` into the job
  # would make the gate `eval 'true'` — a no-op: it compiles nothing, the working
  # tree is unchanged, and the gate exits 0 "in sync" while real drift slips
  # through. The ci-success anti-tamper cannot catch this (the job result is
  # `success`, not `skipped`). But a wiring PR edits ci.yml → needs-ci=true → runs
  # THIS suite, so this assertion fails that required check at introduction time.
  #
  # COMMENT-STRIP: strip full-comment lines first so a doc comment that legitimately
  # names the seam does not trip the check; an attacker's `env:` wiring is a
  # non-comment line and is still caught. ghaw_block is one job block (well under
  # the pipe buffer), so the inner grep|grep pipe carries no SIGPIPE risk.
  if grep -v '^[[:space:]]*#' <<<"$ghaw_block" | grep -q 'GHAW_COMPILE_CMD'; then
    fail "ghaw-lock-sync job exposes the GHAW_COMPILE_CMD test seam in an executable line — gate can be no-op'd into a false pass"
  else
    pass "ghaw-lock-sync job does not wire the GHAW_COMPILE_CMD test seam (gate cannot be bypassed via job env)"
  fi

  # ci-success's needs: list is the required-check surface. Pull the block from
  # 'ci-success:' to its steps: and assert ghaw-lock-sync is one of its needs.
  # Anchor each match to the whole list entry ($) so '- ghaw-lock-sync' cannot be
  # satisfied by a longer substring entry and vice-versa.
  cisuccess_needs="$(awk '/^  ci-success:/{f=1} f{print} /^    steps:/{if(f)exit}' <<<"$ci")"
  if grep -qE '^      - ghaw-lock-sync$' <<<"$cisuccess_needs"; then
    pass "ci-success requires the ghaw-lock-sync job"
  else
    fail "ghaw-lock-sync is not in ci-success needs — gate is not required"
  fi

  # The gate's OWN decision logic must be unit-tested by a REQUIRED check. The
  # self-tests ride the lockfile-sync-tests (CI Self-Defense Tests) job, which is
  # gated on needs-ci || needs-agentic || needs-onboarding — and every gh-aw
  # trigger surface is a subset of those (a .md/.lock.yml edit sets needs-ci via
  # ^\.github/workflows/ and needs-onboarding via ^\.github/; a .github/aw/ edit
  # sets needs-onboarding; the guard/test under scripts/ sets needs-ci), so the
  # gh-aw self-test always re-runs when its surface moves without widening that
  # job's if:. Pin that the suite is invoked there.
  lst_block="$(awk '/^  lockfile-sync-tests:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  lockfile-sync-tests:/{exit}' <<<"$ci")"

  if grep -qF 'bash scripts/__tests__/check-ghaw-lock-sync.test.sh' <<<"$lst_block"; then
    pass "CI Self-Defense Tests job runs the gh-aw gate's bash suite"
  else
    fail "CI Self-Defense Tests job does not run the gh-aw gate bash suite"
  fi

  # The self-defense job shellchecks every gate script + suite; the gate, the
  # compiler-version helper it now delegates the pin derivation to, AND the suite
  # must all be in that list so a shell bug in any of them fails a required check.
  if grep -qF 'scripts/check-ghaw-lock-sync.sh' <<<"$lst_block" \
     && grep -qF 'scripts/get-ghaw-compiler-version.sh' <<<"$lst_block" \
     && grep -qF 'scripts/__tests__/check-ghaw-lock-sync.test.sh' <<<"$lst_block"; then
    pass "CI Self-Defense Tests job shellchecks the gh-aw guard + helper + suite"
  else
    fail "CI Self-Defense Tests job does not shellcheck the gh-aw guard/helper/suite"
  fi
else
  fail "ci.yml not found at $CI_YML"
fi

echo ""
echo "=== gate script hardening (structural) ==="
# These pin properties of check-ghaw-lock-sync.sh that are NOT observable as a
# portable runtime RED on this dev host, so we lock them structurally (each is
# mutation-provable: gut the property in the script and the matching case fails).
#
# WHY STRUCTURAL, NOT A SIGNAL RACE (compile_log cleanup): the gate captures
# gh-aw's output to a mktemp file during a multi-second compile. If the job is
# cancelled (CI sends SIGTERM) mid-compile, that tmpfile must still be removed.
# macOS bash 3.2 (this host) DEFERS SIGTERM while waiting on a foreground child
# and then runs the fail-branch cleanup, so the leak simply does not reproduce
# here — only Linux bash 5.x (the CI runner), which does NOT run an EXIT trap on
# an *untrapped* SIGTERM, leaks. A behavioural signal test would therefore pass
# on macOS regardless of the fix (a fake green). We instead require the cleanup
# to be wired as an EXIT trap PLUS an explicit TERM/INT handler (the handler's
# `exit` is what makes the EXIT trap fire under Linux's signal semantics).

# compile_log is cleaned via an EXIT trap, not only an explicit happy-path rm.
if grep -Eq "trap .*rm -f .*compile_log.* EXIT" "$SCRIPT"; then
  pass "gate cleans up compile_log via an EXIT trap (covers early-exit / signal paths)"
else
  fail "gate has no EXIT trap for compile_log — a signal/early-exit between mktemp and cleanup leaks it"
fi

# The "check, not a fix" invariant (the gate restores the working tree it mutated
# while recompiling) must hold on EVERY exit path, not just the two explicit
# branches. restore_tree therefore has to be wired into the EXIT trap. Why
# STRUCTURAL, not behavioural: the path that an explicit-call-only restore MISSES
# is signal-driven cancellation — CI sends SIGTERM mid-drift-report, the TERM
# handler `exit`s, and an EXIT trap that only rm'd compile_log would leave the
# recompiled locks in place. macOS bash 3.2 (this host) DEFERS SIGTERM to the
# foreground child and does not reproduce the leak, so a behavioural signal test
# would be a fake green here (same reason the compile_log cleanup above is pinned
# structurally). It is also defence against a future `set -e`: without -e the
# post-`head -60` `restore_tree` is reached even when the diff pipeline SIGPIPEs,
# but adding -e later would skip it — the EXIT trap makes restoration robust to
# that too. Mutation-provable: drop restore_tree from the trap and this fails.
if grep -Eq "trap '.*restore_tree.*' EXIT" "$SCRIPT"; then
  pass "gate restores the working tree via the EXIT trap (covers signal cancellation / future set -e)"
else
  fail "gate does not wire restore_tree into the EXIT trap — a SIGTERM mid-drift-report leaves the tree mutated"
fi

# The TERM (and INT) handler that forces the EXIT trap to run under Linux bash on
# CI cancellation. Without it the EXIT-only trap does NOT fire on an untrapped
# SIGTERM on the CI runner, so the tmpfile leaks exactly when it matters.
if grep -qF "trap 'exit 143' TERM" "$SCRIPT"; then
  pass "gate installs a TERM handler so the EXIT trap fires on CI cancellation (Linux bash)"
else
  fail "gate has no TERM handler — Linux bash won't run the EXIT trap on SIGTERM, leaking compile_log"
fi

if grep -qF "trap 'exit 130' INT" "$SCRIPT"; then
  pass "gate installs an INT handler so the EXIT trap fires on interactive cancellation"
else
  fail "gate has no INT handler — the EXIT trap won't fire on an untrapped SIGINT, leaking compile_log"
fi

# DETERMINISM invariant: the DEFAULT compile command runs with --no-check-update
# so the gate never phones home for a gh-aw self-update mid-CI (which would make
# the run non-deterministic / network-dependent). ($GHAW_COMPILE_CMD is a
# test-only seam, never set in CI, so the default is what actually runs.)
if grep -E '^(COMPILE_CMD|BASE_COMPILE)=' "$SCRIPT" | grep -q -- '--no-check-update'; then
  pass "default compile command runs with --no-check-update (deterministic, no mid-CI self-update)"
else
  fail "default compile command is missing --no-check-update — gate may self-update gh-aw mid-CI"
fi

# DETERMINISM invariant (negative): the default must NOT pass
# --force-refresh-action-pins, which clears the cache and re-resolves every action
# SHA from the GitHub API — turning a hermetic, pin-driven recompile into a
# network-dependent one that can drift on upstream tag movement, not contributor error.
if grep -E '^(COMPILE_CMD|BASE_COMPILE)=' "$SCRIPT" | grep -q -- '--force-refresh-action-pins'; then
  fail "default compile command forces fresh action-pin resolution — gate becomes network-dependent / non-hermetic"
else
  pass "default compile command does not force network action-pin resolution (hermetic, pin-driven)"
fi

# The human remediation hint and the actual compile command single-source from
# $BASE_COMPILE, so the "Fix: run ..." line printed to a developer cannot drift
# from the command the gate itself runs.
if grep -qE '^BASE_COMPILE=' "$SCRIPT"; then
  pass "gate defines a single-sourced BASE_COMPILE"
else
  fail "gate has no BASE_COMPILE — remediation hint and compile command can drift apart"
fi
# SC2016: the single quotes are intentional — we assert the LITERAL token
# '$BASE_COMPILE' appears in the script source (i.e. the echo references the
# variable rather than hardcoding the command), so it must NOT be expanded here.
# shellcheck disable=SC2016
if grep -A2 'Fix: from the repo root' "$SCRIPT" | grep -qF '$BASE_COMPILE'; then
  pass "remediation hint echoes \$BASE_COMPILE (single-sourced, cannot drift)"
else
  fail "remediation hint hardcodes the command instead of \$BASE_COMPILE"
fi

echo ""
echo "=== suite hygiene (structural) ==="
# Regression lock for the SIGPIPE-under-pipefail false failure documented at the
# top of this file. Piping a large variable into grep/awk (via `echo`) lets the
# reader close the pipe on an early match and SIGPIPE the upstream writer;
# pipefail then reports the whole pipeline as failed — a real match misreported
# as a miss (this hit CI on the ~31 KB ci.yml). The fix is here-strings
# (`grep PAT <<<"$var"`). This guard fails if the antipattern is reintroduced
# anywhere in this suite. The needle below glues `echo` to `[[:space:]]` (no
# space between them), so this guard line can never match itself. The variable
# alternation covers BOTH the bare `$VAR` and the braced `${VAR}` forms — the
# brace form is just as SIGPIPE-prone and must not slip past the guard.
SELF="${BASH_SOURCE[0]}"
if grep -nE 'echo[[:space:]]+"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"[[:space:]]*\|[[:space:]]*(grep|awk)' "$SELF" >/dev/null; then
  fail "a variable's echo output is piped into grep/awk — feed it via a here-string (see the SIGPIPE-safe note at the top) to stay correct under pipefail"
else
  pass "suite feeds grep/awk via here-strings, not variable pipes (SIGPIPE-safe under pipefail)"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
