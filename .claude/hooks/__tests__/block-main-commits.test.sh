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

# --- BYPASS (a): `-c key=val` between `git` and `commit` dodged the old regex ---
run_hook "$MAIN_REPO" "git -c user.name=x commit -m 'msg'"
check "git -c <cfg> commit with cwd on main blocked (bypass a)" 2

run_hook "$FEAT_REPO" "git -c user.name=x commit -m 'msg'"
check "git -c <cfg> commit on feature branch allowed" 0

run_hook "$MAIN_REPO" "git -c a=b -C $FEAT_REPO commit -m 'msg'"
check "git -c <cfg> -C <feature-dir> commit allowed from main cwd" 0

# --- BYPASS (b): the checkout -b allowance was whole-command, so a later
# --- switch BACK to main in the same chain rode through it ---
run_hook "$MAIN_REPO" "git checkout -b tmp && git checkout main && $GC -m 'msg'"
check "checkout -b then checkout main then commit blocked (bypass b)" 2

run_hook "$MAIN_REPO" "git switch -c tmp && git switch main && $GC -m 'msg'"
check "switch -c then switch main then commit blocked (bypass b)" 2

run_hook "$MAIN_REPO" "git checkout -b tmp && cd $MAIN_REPO && $GC -m 'msg'"
check "cd after checkout -b resets the escape hatch (bypass b)" 2

# --- BYPASS (c): segments were split only on && and ; so || chains slid by ---
run_hook "$FEAT_REPO" "cd $MAIN_REPO || true; $GC -m 'msg'"
check "cd <main> || true; commit blocked from feature cwd (bypass c)" 2

run_hook "$MAIN_REPO" "false || $GC -m 'msg'"
check "|| chain reaching commit on main blocked (bypass c)" 2

run_hook "$MAIN_REPO" "$GC -m 'msg' || echo failed"
check "commit before || on main blocked" 2

run_hook "$MAIN_REPO" "cd $FEAT_REPO || exit 1 && $GC -m 'msg'"
check "cd <feature> || exit guard then commit allowed" 0

# --- BYPASS (d): GIT_DIR/--git-dir redirection and non-`commit` subcommands
# --- that create commits (merge, cherry-pick, revert, pull) or restage work
# --- for one (stash pop) ---
run_hook "$FEAT_REPO" "GIT_DIR=$MAIN_REPO/.git $GC -m 'msg'"
check "GIT_DIR=<main .git> commit blocked from feature cwd (bypass d)" 2

run_hook "$FEAT_REPO" "git --git-dir=$MAIN_REPO/.git commit -m 'msg'"
check "--git-dir=<main .git> commit blocked from feature cwd (bypass d)" 2

run_hook "$MAIN_REPO" "GIT_DIR=$FEAT_REPO/.git $GC -m 'msg'"
check "GIT_DIR=<feature .git> commit allowed from main cwd" 0

run_hook "$FEAT_REPO" "git --work-tree=$MAIN_REPO commit -m 'msg'"
check "--work-tree=<main checkout> commit blocked (conservative)" 2

run_hook "$MAIN_REPO" "git merge feat/other"
check "git merge on main blocked (bypass d)" 2

run_hook "$FEAT_REPO" "git merge feat/other"
check "git merge on feature branch allowed" 0

run_hook "$MAIN_REPO" "git cherry-pick abc1234"
check "git cherry-pick on main blocked (bypass d)" 2

run_hook "$MAIN_REPO" "git revert HEAD"
check "git revert on main blocked (bypass d)" 2

run_hook "$MAIN_REPO" "git stash pop"
check "git stash pop on main blocked (bypass d)" 2

run_hook "$MAIN_REPO" "git pull origin main"
check "git pull (mergeable) on main blocked (bypass d)" 2

run_hook "$MAIN_REPO" "git pull --ff-only origin main"
check "git pull --ff-only on main allowed (cannot create commits)" 0

run_hook "$FEAT_REPO" "git pull"
check "git pull on feature branch allowed" 0

# --- FINDING 1: long options with a SPACE-separated value (no `=`) must not
# --- let the subcommand slip past the detector ---
run_hook "$FEAT_REPO" "git --git-dir $MAIN_REPO/.git commit -m 'msg'"
check "--git-dir <space value> commit blocked from feature cwd (finding 1)" 2

run_hook "$MAIN_REPO" "git --git-dir $FEAT_REPO/.git commit -m 'msg'"
check "--git-dir <space value> commit allowed when target is feature (finding 1)" 0

run_hook "$FEAT_REPO" "git --work-tree $MAIN_REPO commit -m 'msg'"
check "--work-tree <space value> commit blocked (conservative, finding 1)" 2

# --- FINDING 2: branch-target extraction must tolerate the global-option chain ---
run_hook "$MAIN_REPO" "git -C $MAIN_REPO checkout -b feat/x && git -C $MAIN_REPO commit -m 'msg'"
check "git -C <repo> checkout -b feat/x then git -C <repo> commit allowed (finding 2)" 0

run_hook "$MAIN_REPO" "git -c k=v checkout main && $GC -m 'msg'"
check "git -c k=v checkout main then commit blocked (finding 2)" 2

run_hook "$MAIN_REPO" "git -c k=v switch -c feat/y && $GC -m 'msg'"
check "git -c k=v switch -c feat/y then commit allowed (finding 2)" 0

# --- FINDING 3: force-create forms (-B / -C) set the pending branch too ---
run_hook "$MAIN_REPO" "git checkout -B main && $GC -m 'msg'"
check "checkout -B main then commit blocked (finding 3)" 2

run_hook "$MAIN_REPO" "git checkout -B feat/x && $GC -m 'msg'"
check "checkout -B feat/x then commit allowed (finding 3)" 0

run_hook "$MAIN_REPO" "git switch -C main && $GC -m 'msg'"
check "switch -C main then commit blocked (finding 3)" 2

run_hook "$MAIN_REPO" "git switch -C feat/x && $GC -m 'msg'"
check "switch -C feat/x then commit allowed (finding 3)" 0

# --- FINDING 4: a plain switch to an existing NON-main branch from a main
# --- checkout must not be false-blocked ---
run_hook "$MAIN_REPO" "git checkout feat/existing && $GC -m 'msg'"
check "checkout <existing-feature> then commit allowed from main (finding 4)" 0

run_hook "$MAIN_REPO" "git switch feat/existing && $GC -m 'msg'"
check "switch <existing-feature> then commit allowed from main (finding 4)" 0

# The pathspec form (checkout <ref> -- <pathspec>) is NOT a branch switch and
# must leave the branch decided by cwd — a restore on main still blocks.
run_hook "$MAIN_REPO" "git checkout HEAD -- file.txt && $GC -m 'msg'"
check "checkout <ref> -- <pathspec> is not a switch; commit on main still blocked (finding 4)" 2

# --- FINDING 5: the block reason must name the resolving context ---
run_hook "$MAIN_REPO" "cd $FEAT_REPO && $GC -m 'a' && cd $MAIN_REPO && $GC -m 'b'"
check "chained main-directed commit blocked (finding 5 setup)" 2
case "$HOOK_STDERR" in
  *"$MAIN_REPO"*) PASS=$((PASS + 1)); echo "ok: block reason names the resolving directory (finding 5)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: block reason omits resolving directory context (finding 5)" ;;
esac

run_hook "$MAIN_REPO" "git checkout main && $GC -m 'msg'"
check "checkout main then commit blocked (finding 5 pending setup)" 2
case "$HOOK_STDERR" in
  *"pending branch"*) PASS=$((PASS + 1)); echo "ok: block reason names the pending branch (finding 5)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: block reason omits pending-branch context (finding 5)" ;;
esac

# --- word-boundary near-miss: 'git' as a suffix of another word ---
run_hook "$MAIN_REPO" "echo 'legit commit'"
check "'legit commit' text near-miss allowed on main" 0

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
