#!/usr/bin/env bash
# gh-aw lock-drift gate — fail a PR when a GitHub Agentic Workflow source was
# changed without recompiling its generated `.lock.yml`.
#
# WHAT IT GUARDS
# gh-aw compiles each author-edited `.github/workflows/*.md` source into a
# generated sibling `*.lock.yml` ("DO NOT EDIT … run gh aw compile"), injecting
# SHA-pinned action refs from `.github/aw/actions-lock.json`. The `.lock.yml` is
# the workflow GitHub actually runs. Editing a `.md` source, or an action pin in
# `.github/aw/`, WITHOUT re-running `gh aw compile` leaves the committed
# `.lock.yml` stale — the running workflow silently diverges from its source.
# This is the gh-aw analogue of package-lock drift, and it shipped live (the
# parity review found committed locks pinning a different gh-aw compiler version
# than `.github/aw/actions-lock.json`). The contributor most likely to hit it is
# a non-Claude one who edits a `.md` and never learns the compiler exists. This
# gate trips BEFORE merge: it recompiles from the committed sources/pins and
# fails if the result differs from what is committed.
#
# FOUR DRIFT VECTORS, all caught via `git status --porcelain`:
#   1. a tracked `.lock.yml` recompiles to different content (edited source/pin),
#   2. a NEW source whose `.lock.yml` was never compiled (untracked lock appears),
#   3. an orphan `.lock.yml` whose source was deleted (`--purge` removes it),
#   4. an action-pin bump in `.github/aw/` that changes injected SHAs.
#
# SECURITY: the compile command is overridable via $GHAW_COMPILE_CMD and run
# through `eval` purely as a TEST SEAM — the unit test
# (scripts/__tests__/check-ghaw-lock-sync.test.sh) injects a stub so it can run
# hermetically without the gh-aw extension or the network. CI never sets the
# variable; it uses the default real `gh aw compile`. The value is therefore
# trusted (it originates from this repo's own workflow/test, never from PR
# contents or any untrusted input), so the `eval` carries no injection risk.
# Do NOT wire this variable to anything attacker-controllable.
#
# What the gate DOES feed the compiler is PR-contributed content: the .md
# sources and .github/aw/actions-lock.json. That is an accepted, necessary trust
# boundary — the gate cannot detect drift without recompiling from those files —
# and it is safe because `gh aw compile` is a static template compiler that
# transforms Markdown-plus-frontmatter into YAML; it does not execute code from
# the sources or the pin manifest. There is therefore no --ignore-scripts-style
# flag to add here (contrast scripts/check-lockfile-sync.sh, which passes
# --ignore-scripts precisely because `npm install` WOULD otherwise run hostile
# package.json lifecycle scripts).
set -uo pipefail
shopt -s nullglob

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || { echo "::error::could not cd to repo root"; exit 1; }

# --- early exit: nothing to reconcile ----------------------------------------
# A repo with no gh-aw sources AND no compiled locks has nothing to guard. Bail
# BEFORE the (network/toolchain-heavy) compile so CI never installs or runs the
# gh-aw extension on a repo that does not use agentic workflows.
mds=(.github/workflows/*.md)
locks=(.github/workflows/*.lock.yml)
if [ ${#mds[@]} -eq 0 ] && [ ${#locks[@]} -eq 0 ]; then
  echo "✓ gh-aw-lock-sync: no gh-aw workflows to reconcile — pass"
  exit 0
fi

# Single-source the compile command so the human remediation hint printed on
# drift can never drift from what the gate actually runs. BASE_COMPILE is the
# bare command a developer runs locally to fix drift:
#   --no-check-update : never phone home for a gh-aw self-update mid-CI (keeps the
#                       run deterministic and offline-safe).
#   --purge           : non-interactively delete orphan `.lock.yml` whose source
#                       was removed (closes drift vector 3).
# It deliberately does NOT pass --force-refresh-action-pins, which re-resolves
# every action SHA from the network — that would make the gate network-dependent
# and able to "drift" on upstream tag movement rather than contributor error.
# $GHAW_COMPILE_CMD is a TEST-ONLY seam (see header) and is never set in CI, so
# the default below is what actually runs.
BASE_COMPILE='gh aw compile --no-check-update --purge'
COMPILE_CMD="${GHAW_COMPILE_CMD:-$BASE_COMPILE}"

# Snapshot untracked locks BEFORE compiling so restore removes only the locks the
# compile itself produced, never an untracked lock the developer already had.
status_before="$(git status --porcelain -- .github/workflows/ 2>/dev/null || true)"
BEFORE_UNTRACKED="$(grep -E '^\?\? .*\.lock\.yml$' <<<"$status_before" | sed 's/^?? //' || true)"

# Restore the working tree to its committed state. The compile only ever touches
# `*.lock.yml` files (recompiling tracked ones, deleting orphans via --purge,
# creating new ones), so restore is SCOPED to lock files — it reverts the tracked
# locks the compile modified or deleted and removes ONLY the untracked locks the
# compile newly created. It deliberately does NOT `git checkout -- .github/workflows/`
# wholesale: the EXIT trap fires restore on EVERY path (so signal cancellation
# can't leave a recompiled tree behind), INCLUDING the happy in-sync path, and a
# dir-wide checkout would clobber an unrelated in-flight edit (e.g. to ci.yml)
# that the gate never made. A check may only undo what IT changed.
# Invoked solely from the EXIT trap below. The trap is a single-quoted string,
# which the linter cannot see into, so SC2329 "never invoked" is a false positive.
# shellcheck disable=SC2329
restore_tree() {
  local tracked now f
  # Revert tracked locks the compile modified or deleted. `git ls-files` lists
  # index entries, so a lock deleted in the worktree (orphan --purge) is still
  # named here and `git checkout --` revives it. Scoped to *.lock.yml only.
  tracked="$(git ls-files -- '.github/workflows/*.lock.yml' 2>/dev/null || true)"
  if [ -n "$tracked" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      git checkout -- "$f" 2>/dev/null || true
    done <<<"$tracked"
  fi
  now="$(git ls-files --others --exclude-standard -- .github/workflows/ 2>/dev/null | grep -E '\.lock\.yml$' || true)"
  [ -n "$now" ] || return 0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    # Leave any lock that was already untracked before the gate ran.
    if ! grep -Fxq -- "$f" <<<"$BEFORE_UNTRACKED"; then
      rm -f "$f"
    fi
  done <<<"$now"
}

# --- recompile, capturing the compiler's own output --------------------------
# Capture stdout+stderr so a real gh-aw failure (bad source, missing pin,
# toolchain error) is surfaced in the gate log instead of swallowed — a silent
# "compile command failed" is un-actionable.
compile_log="$(mktemp)"
# Restore the tree AND clean up the tmpfile on EVERY exit path, via the EXIT trap.
# Putting restore_tree in the trap (not only in the two explicit branches below)
# is what makes the "check, not a fix" invariant hold unconditionally:
#   * Signal cancellation — CI sends SIGTERM mid-compile/mid-drift-report. The
#     TERM/INT handlers `exit`, which fires the EXIT trap; an explicit-call-only
#     restore would be skipped on that path, leaving the recompiled locks in place.
#   * Future `set -e` — today (no -e) the post-`head -60` restore is still reached
#     even if the diff pipeline SIGPIPEs, but adding -e later would skip it; the
#     trap makes restoration robust to that.
# The explicit TERM/INT handlers are not redundant with the EXIT trap: on the
# Linux runner (bash 5.x) an EXIT trap does NOT run for an *untrapped* terminating
# signal, so without them the trap would not fire on cancellation; the handler's
# `exit` is what triggers it. restore_tree is idempotent (a clean re-run is a
# no-op: nothing to checkout, no newly-untracked locks to remove), so firing it on
# the in-sync happy path costs nothing.
trap 'restore_tree; rm -f "$compile_log"' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
if ! eval "$COMPILE_CMD" >"$compile_log" 2>&1; then
  echo "::error::gh-aw lock compile command failed: $COMPILE_CMD"
  echo "--- compile command output ---"
  cat "$compile_log"
  echo "--- end compile command output ---"
  # restore_tree runs via the EXIT trap.
  exit 1
fi

# --- detect drift -------------------------------------------------------------
# Any change under .github/workflows/ to a `.lock.yml` (modified, deleted, or
# newly untracked) is drift. Feed grep from a here-string, not `git status | grep`
# (SIGPIPE-safe under pipefail; see #8687).
status_after="$(git status --porcelain -- .github/workflows/ 2>/dev/null || true)"
drift="$(grep -E '\.lock\.yml$' <<<"$status_after" || true)"

if [ -z "$drift" ]; then
  echo "✓ gh-aw-lock-sync: compiled .lock.yml files are in sync with their sources — pass"
  exit 0
fi

# Drift: report with remediation, then restore so the gate leaves no mutation.
echo "::error::gh-aw lock drift detected — compiled .lock.yml files do not match their workflow sources."
echo ""
echo "A .github/workflows/*.md source (or an action pin under .github/aw/) changed"
echo "without re-running the gh-aw compiler, so the committed .lock.yml that GitHub"
echo "actually runs is stale."
echo ""
echo "Fix: from the repo root, run"
echo "    $BASE_COMPILE"
echo "then commit the updated .github/workflows/*.lock.yml."
echo ""
echo "Drift (porcelain status):"
printf '%s\n' "$drift"
echo ""
echo "Diff (first 60 lines):"
# `|| true`: head closing the pipe early can SIGPIPE the diff (status 141) under
# pipefail; swallow it so the report is never the script's failing status. The
# real exit status is the explicit `exit 1` below, and restore_tree runs via the
# EXIT trap regardless of how we leave (explicit exit or signal cancellation).
git --no-pager diff -- .github/workflows/ | head -60 || true
exit 1
