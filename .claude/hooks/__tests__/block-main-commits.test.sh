#!/bin/bash
# Tests for block-main-commits.sh — the PreToolUse Bash hook that blocks
# `git commit` on main/master while allowing feature-branch commits,
# INCLUDING commits targeted at another directory via `cd <dir> &&` or
# `git -C <dir>` while the hook's own cwd sits on main (the worktree
# false-positive regression: builders in .claude/worktrees/* were blocked
# 100% of the time whenever the main checkout was parked on main).
#
# Contract: exit 0 = allow, exit 2 = block (stderr carries the reason).

set -u

HOOK="$(cd "$(dirname "$0")/.." && pwd)/block-main-commits.sh"

command -v jq >/dev/null 2>&1 || { echo "SKIP: jq not installed"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "SKIP: git not installed"; exit 1; }
[ -f "$HOOK" ] || { echo "FAIL: hook not found at $HOOK"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Fixture repos: one parked on main, one on a feature branch, one on a
# feature branch at a path containing a space.
MAIN_REPO="$TMP/main-repo"
FEAT_REPO="$TMP/feat-repo"
SPACE_REPO="$TMP/space dir/feat-repo"
git init -q -b main "$MAIN_REPO"
git init -q -b feat/some-work "$FEAT_REPO"
mkdir -p "$TMP/space dir"
git init -q -b feat/spaced "$SPACE_REPO"

PASS=0
FAIL=0

# run_hook <cwd> <command-string>  → sets HOOK_EXIT and HOOK_STDERR
run_hook() {
  local cwd="$1" cmd="$2" payload
  payload=$(jq -nc --arg c "$cmd" '{tool_input: {command: $c}}')
  HOOK_STDERR=$(cd "$cwd" && printf '%s' "$payload" | bash "$HOOK" 2>&1 1>/dev/null)
  HOOK_EXIT=$?
}

check() {
  local desc="$1" expected="$2"
  if [ "$HOOK_EXIT" -eq "$expected" ]; then
    PASS=$((PASS + 1))
    echo "ok: $desc"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $desc (expected exit $expected, got $HOOK_EXIT)"
  fi
}

GC="git commit"   # avoid tripping the live hook on this test file's own runs

# --- non-commit commands pass through ---
run_hook "$MAIN_REPO" "ls -la"
check "non-git command allowed" 0

run_hook "$MAIN_REPO" "git log --oneline | grep commitish"
check "git log mentioning 'commit' substring allowed (word-boundary near-miss)" 0

# --- fail-safe on malformed stdin ---
HOOK_STDERR=$(cd "$MAIN_REPO" && printf 'not json at all' | bash "$HOOK" 2>&1 1>/dev/null)
HOOK_EXIT=$?
check "malformed stdin fails open (exit 0, no jq error propagation)" 0

# --- plain commits: hook cwd decides ---
run_hook "$MAIN_REPO" "$GC -m 'msg'"
check "commit with cwd on main blocked" 2
case "$HOOK_STDERR" in
  *BLOCKED*) PASS=$((PASS + 1)); echo "ok: block reason on stderr" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: block reason missing from stderr" ;;
esac

run_hook "$FEAT_REPO" "$GC -m 'msg'"
check "commit with cwd on feature branch allowed" 0

# --- the worktree regression: cd into a feature-branch dir while hook cwd is on main ---
run_hook "$MAIN_REPO" "cd $FEAT_REPO && git add -A && $GC -m 'msg'"
check "cd <feature-worktree> && commit allowed while hook cwd on main (REGRESSION)" 0

run_hook "$MAIN_REPO" "cd \"$SPACE_REPO\" && $GC -m 'msg'"
check "cd '<path with space>' && commit allowed while hook cwd on main" 0

run_hook "$FEAT_REPO" "cd $MAIN_REPO && $GC -m 'msg'"
check "cd <main checkout> && commit blocked even from feature-branch cwd" 2

# --- relative cd ---
mkdir -p "$FEAT_REPO/web"
run_hook "$FEAT_REPO" "cd web && $GC -m 'msg'"
check "relative cd inside feature repo allowed" 0

# --- git -C form (was a loophole: old regex never matched it) ---
run_hook "$MAIN_REPO" "git -C $FEAT_REPO commit -m 'msg'"
check "git -C <feature-dir> commit allowed while hook cwd on main" 0

run_hook "$FEAT_REPO" "git -C $MAIN_REPO commit -m 'msg'"
check "git -C <main checkout> commit blocked from feature cwd" 2

run_hook "$MAIN_REPO" "git -C \"$SPACE_REPO\" commit -m 'msg'"
check "git -C '<path with space>' commit allowed" 0

# --- multiple chained commits: any main-targeted commit blocks ---
run_hook "$MAIN_REPO" "cd $FEAT_REPO && $GC -m 'a' && cd $MAIN_REPO && $GC -m 'b'"
check "chain with a later main-directed commit blocked" 2

# --- new-branch escape hatch preserved ---
run_hook "$MAIN_REPO" "git checkout -b feat/new-thing && git add . && $GC -m 'msg'"
check "checkout -b before commit allowed on main" 0

run_hook "$MAIN_REPO" "git switch -c feat/new-thing && $GC -m 'msg'"
check "switch -c before commit allowed on main" 0

# --- master is blocked like main ---
MASTER_REPO="$TMP/master-repo"
git init -q -b master "$MASTER_REPO"
run_hook "$MASTER_REPO" "$GC -m 'msg'"
check "commit with cwd on master blocked" 2

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
