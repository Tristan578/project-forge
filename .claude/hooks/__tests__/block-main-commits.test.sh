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

# --- PF-995 addendum coverage ---

# A second main-branch fixture whose path contains a space, for the quoted
# --git-dir test below (SPACE_REPO is a feature branch, not main).
SPACE_MAIN_REPO="$TMP/space main/main-repo2"
mkdir -p "$TMP/space main"
git init -q -b main "$SPACE_MAIN_REPO"

# --- PATH 1: the whole-command filter matches but quoting inside a `-c`
# --- value (containing a literal `&&`) defeats the awk `&&`/`||`/`;` segment
# --- split — no split segment re-matches GIT_MUTATE_RE on its own, so
# --- COMMIT_TARGETS stays empty and HANDLED stays 0. The fallback must still
# --- resolve the commit against the hook's own tracked $PWD rather than
# --- silently allowing it.
QUOTE_DEFEAT_CMD='git -c key="a&&b" commit -m msg'
run_hook "$MAIN_REPO" "$QUOTE_DEFEAT_CMD"
check "quote-defeated segment split falls back to \$PWD, blocked on main (fallback safety net)" 2
case "$HOOK_STDERR" in
  *"$MAIN_REPO"*) PASS=$((PASS + 1)); echo "ok: fallback block names \$PWD as the resolving directory" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: fallback block did not name \$PWD" ;;
esac

run_hook "$FEAT_REPO" "$QUOTE_DEFEAT_CMD"
check "quote-defeated segment split falls back to \$PWD, allowed on feature branch (fallback safety net)" 0

# --- PATH 2: `checkout <branch> -- <pathspec>` in both directions — the
# --- named ref is a real branch name (not just HEAD), and must never be
# --- treated as a switch: it restores files only, leaving the effective
# --- branch exactly where cwd already had it.
run_hook "$FEAT_REPO" "git checkout main -- file.txt && $GC -m 'msg'"
check "checkout main -- <pathspec> is not a switch; commit stays on feature branch, allowed" 0

run_hook "$MAIN_REPO" "git checkout feat/existing -- file.txt && $GC -m 'msg'"
check "checkout <feature-name> -- <pathspec> must not smuggle an allow from main; still blocked" 2

# --- PATH 4: fail-open when the -C target directory cannot be resolved at
# --- all (not merely a different repo — a path that does not exist). The
# --- `git -C <dir> branch --show-current` lookup errors, CURRENT_BRANCH is
# --- empty, and empty is neither "main" nor "master" — so the documented
# --- fail-open posture allows the commit through.
run_hook "$MAIN_REPO" "git -C /nonexistent-dir-xyz-123 commit -m 'msg'"
check "git -C <nonexistent dir> commit fails open (allowed) per documented posture" 0

# --- PATH 5: master-branch parity for the four fixed bypass classes, run
# --- from a feature-branch cwd so only the redirection/target decides.
run_hook "$FEAT_REPO" "GIT_DIR=$MASTER_REPO/.git $GC -m 'msg'"
check "GIT_DIR=<master .git> commit blocked (master parity: env-prefix)" 2

run_hook "$FEAT_REPO" "git -C $MASTER_REPO commit -m 'msg'"
check "git -C <master checkout> commit blocked (master parity: -C dir)" 2

run_hook "$FEAT_REPO" "cd $MASTER_REPO && $GC -m 'msg'"
check "cd <master checkout> && commit blocked (master parity: cd-chain)" 2

run_hook "$FEAT_REPO" "git --git-dir=$MASTER_REPO/.git commit -m 'msg'"
check "--git-dir=<master .git> commit blocked (master parity: --git-dir=)" 2

# --- PATH 6: quoted-argument variants — a new branch name containing a
# --- space, and a --git-dir value containing a space wrapped in quotes.
run_hook "$MAIN_REPO" 'git checkout -b "branch with space" && git commit -m msg'
check "checkout -b \"<branch with space>\" then commit allowed from main" 0

run_hook "$FEAT_REPO" "git --git-dir=\"$SPACE_MAIN_REPO/.git\" commit -m 'msg'"
check "--git-dir=\"<quoted path with space>\" targeting a main repo blocked" 2

# =====================================================================
# ROUND 2 (PF-995 / #8988): quote-aware classification, separator
# boundaries in the prefilter, `checkout -`/`switch -` previous-branch
# shorthand, and option flags between the switch keyword and its target.
# =====================================================================

# --- FIX 1: quote-aware segment classification. A quoted commit-message
# --- value that happens to contain "git checkout"/"git switch"/"pull
# --- --ff-only" must NOT be classified as a real switch or exemption:
# --- classifiers must scan a quote-stripped copy of each segment. Raw-text
# --- scanning both FALSELY ALLOWS a commit on main (a bogus pending branch
# --- clobbers the main context) and FALSELY BLOCKS a feature-branch commit
# --- (the commit segment is consumed as a switch and the fallback resolves
# --- against the hook's own main cwd). ---

# (a) FALSE ALLOW repro (double-quoted message): the first message contains
# "git checkout feature"; both commits actually target main → must block.
run_hook "$MAIN_REPO" 'git commit -m "see git checkout feature" && git commit -m "real payload"'
check "quoted 'git checkout' in a commit message does not smuggle an allow; commit on main blocked (fix 1, double-quote)" 2

# Single-quoted message variant (single-quote stripping path).
run_hook "$MAIN_REPO" "$GC -m 'see git checkout feature' && $GC -m 'real payload'"
check "quoted 'git checkout' (single quotes) in a message; commit on main blocked (fix 1)" 2

# (b) FALSE BLOCK repro: from a main cwd, cd into a feature worktree and
# commit with a message mentioning git checkout/switch — must be allowed.
run_hook "$MAIN_REPO" "cd $FEAT_REPO && $GC -m 'add git checkout helper'"
check "quoted 'git checkout' in a feature-branch commit message not false-blocked (fix 1, single-quote)" 0

run_hook "$MAIN_REPO" 'cd '"$FEAT_REPO"' && git commit -m "add git switch helper"'
check "quoted 'git switch' in a feature-branch commit message not false-blocked (fix 1, double-quote)" 0

# (c) A quoted `git pull --ff-only` inside a commit message must not activate
# the pull --ff-only exemption and smuggle a commit past the gate on main.
run_hook "$MAIN_REPO" 'git commit -m "sync via git pull --ff-only"'
check "quoted 'git pull --ff-only' in a commit message does not exempt; commit on main blocked (fix 1)" 2

# --- FIX 2: the whole-command mutating-subcommand prefilter and per-segment
# --- mutate detector must recognise a subcommand abutting a shell separator
# --- (`;`, `&&`, `|`, `)`), not only whitespace/end. Otherwise the prefilter
# --- early-exits 0 (allow) before the per-segment loop ever runs. ---
run_hook "$MAIN_REPO" "$GC;"
check "commit abutting ';' (no trailing space) blocked on main (fix 2)" 2

run_hook "$MAIN_REPO" "$GC;git push"
check "commit abutting ';git push' blocked on main (fix 2)" 2

run_hook "$MAIN_REPO" "$GC&&echo done"
check "commit abutting '&&echo' blocked on main (fix 2)" 2

run_hook "$MAIN_REPO" "$GC|cat"
check "commit abutting '|cat' blocked on main (fix 2)" 2

run_hook "$MAIN_REPO" "(git commit)"
check "commit wrapped in parens blocked on main (fix 2)" 2

run_hook "$MAIN_REPO" "git stash pop;"
check "stash pop abutting ';' blocked on main (fix 2)" 2

run_hook "$MAIN_REPO" "git add . ; $GC; git push"
check "commit between separators in a longer chain blocked on main (fix 2)" 2

# --- FIX 3: `git checkout -` / `git switch -` (previous-branch shorthand)
# --- must be resolved, not silently ignored. Resolution uses the dir's real
# --- previous branch via `rev-parse --abbrev-ref @{-1}` when no prior
# --- in-command switch occurred, and fails CLOSED (treat as main) when the
# --- previous branch cannot be resolved. ---

# Fixture: HEAD on feat/prev, whose @{-1} previous branch is main → '-' → main.
PREV_MAIN_REPO="$TMP/prev-main"
git init -q -b main "$PREV_MAIN_REPO"
git -C "$PREV_MAIN_REPO" -c user.email=t@e.x -c user.name=t commit -q --allow-empty -m init
git -C "$PREV_MAIN_REPO" checkout -q -b feat/prev

# Fixture: HEAD on main, whose @{-1} previous branch is feat/z → '-' → feat/z.
PREV_FEAT_REPO="$TMP/prev-feat"
git init -q -b main "$PREV_FEAT_REPO"
git -C "$PREV_FEAT_REPO" -c user.email=t@e.x -c user.name=t commit -q --allow-empty -m init
git -C "$PREV_FEAT_REPO" checkout -q -b feat/z
git -C "$PREV_FEAT_REPO" checkout -q main

run_hook "$PREV_MAIN_REPO" "git checkout - && $GC -m 'msg'"
check "'checkout -' back to main then commit blocked (fix 3)" 2

run_hook "$PREV_MAIN_REPO" "git switch - && $GC -m 'msg'"
check "'switch -' back to main then commit blocked (fix 3)" 2

run_hook "$PREV_FEAT_REPO" "git checkout - && $GC -m 'msg'"
check "'checkout -' back to a feature branch then commit allowed (fix 3)" 0

# Fail closed: fresh repo has no @{-1} previous branch → treat as main.
run_hook "$FEAT_REPO" "git checkout - && $GC -m 'msg'"
check "'checkout -' with unresolvable previous branch fails closed, blocked (fix 3)" 2

# --- FIX 4: option flags between the switch keyword and its target
# --- (`checkout -q feat`, `switch --quiet feat`) must be skipped during
# --- target extraction; and a genuine flagged switch that yields no target
# --- must CLEAR any stale pending branch from an earlier switch (fail
# --- closed) rather than leave the stale value in place. ---
run_hook "$MAIN_REPO" "git checkout -q feat/existing && $GC -m 'msg'"
check "'checkout -q feat/existing' (short flag before target) then commit allowed (fix 4)" 0

run_hook "$MAIN_REPO" "git switch --quiet feat/existing && $GC -m 'msg'"
check "'switch --quiet feat/existing' (long flag before target) then commit allowed (fix 4)" 0

run_hook "$MAIN_REPO" "git checkout feat/x && git checkout -q main && $GC -m 'msg'"
check "flagged switch to main clears stale feature pending; commit blocked (fix 4)" 2

# =====================================================================
# ROUND 3 (PF-995 / #8988, review round 2): per-directory pending-branch
# state, `branch -M/-m` detection, `revert`/`merge --no-commit` exemptions,
# subcommand-specific BLOCKED wording, and GIT_WORK_TREE= coverage.
# =====================================================================

# --- ROUND2 FIX 1: PENDING_BRANCH/PENDING_DIR must be keyed per effective
# --- directory. Two independent `-C <dirA>`/`-C <dirB>` `checkout -b`
# --- segments in one compound command must not clobber each other and
# --- false-block the earlier directory's legitimate new branch. ---
PEND_DIR_A="$TMP/pend-a"
PEND_DIR_B="$TMP/pend-b"
git init -q -b main "$PEND_DIR_A"
git init -q -b main "$PEND_DIR_B"

run_hook "$FEAT_REPO" "git -C $PEND_DIR_A checkout -b feat/a && git -C $PEND_DIR_B checkout -b feat/b && git -C $PEND_DIR_A commit -m 'msg'"
check "two -C dirs, each checkout -b: earlier dir's pending branch not clobbered by the later dir (round2 fix 1, dirA)" 0

run_hook "$FEAT_REPO" "git -C $PEND_DIR_A checkout -b feat/a && git -C $PEND_DIR_B checkout -b feat/b && git -C $PEND_DIR_B commit -m 'msg'"
check "two -C dirs, each checkout -b: later dir's own pending branch resolves independently (round2 fix 1, dirB)" 0

# Strongest form of the regression: dirB's switch is a PLAIN switch to main
# (not -b), which the single-scalar implementation would let clobber dirA's
# still-valid pending branch and false-BLOCK a commit that never touches
# dirB's main state at all.
run_hook "$FEAT_REPO" "git -C $PEND_DIR_A checkout -b feat/a && git -C $PEND_DIR_B checkout main && git -C $PEND_DIR_A commit -m 'msg'"
check "dirB switching to main does not clobber dirA's independent pending branch; dirA commit allowed (round2 fix 1)" 0

run_hook "$FEAT_REPO" "git -C $PEND_DIR_A checkout -b feat/a && git -C $PEND_DIR_B checkout main && git -C $PEND_DIR_B commit -m 'msg'"
check "dirB's own pending switch to main still blocks a commit targeting dirB (round2 fix 1)" 2

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
