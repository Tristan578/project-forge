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

# --- ROUND2 FIX 2: `git branch -M main` / `-m master` renames the CURRENT
# --- branch with no checkout/switch keyword involved, so it is invisible to
# --- the checkout|switch detector. A following commit must still be blocked. ---
run_hook "$FEAT_REPO" "git branch -M main && $GC -m 'msg'"
check "'git branch -M main' then commit blocked (round2 fix 2, -M)" 2

run_hook "$FEAT_REPO" "git branch -m master && $GC -m 'msg'"
check "'git branch -m master' then commit blocked (round2 fix 2, -m master)" 2

run_hook "$MAIN_REPO" "git -C $FEAT_REPO branch -M main && git -C $FEAT_REPO commit -m 'msg'"
check "'git -C <dir> branch -M main' then commit on that dir blocked (round2 fix 2, -C form)" 2

# Renaming to a NON-main/master target must not introduce a false block.
run_hook "$FEAT_REPO" "git branch -M feat/renamed && $GC -m 'msg'"
check "'git branch -M <non-main>' then commit still allowed (round2 fix 2, no false block)" 0

# Two-argument `-M <old> <new>` renaming to a NON-main target (`main-ish`) must
# not false-block — the two-arg form is now handled (round 3 fix 4), but only a
# rename whose NEW name is exactly main/master pends.
run_hook "$FEAT_REPO" "git branch -M feat/some-work main-ish && $GC -m 'msg'"
check "'git branch -M <old> <non-main-new>' (two-arg form) does not false-block (round3 fix 4)" 0

# A quoted 'branch -M main' inside a commit message must not be misclassified
# as a real rename (quote-aware classification applies here too).
run_hook "$FEAT_REPO" "$GC -m 'see git branch -M main for details'"
check "quoted 'git branch -M main' in a commit message does not smuggle a false pending-main rename (round2 fix 2)" 0

# =====================================================================
# ROUND2 FIX 3: `git revert --no-commit`/`-n` and `git merge --no-commit`
# create NO commit, exactly analogous to the already-exempted
# `pull --ff-only`. Must be allowed on main; the SAME commands WITHOUT the
# flag must still be blocked.
# =====================================================================
run_hook "$MAIN_REPO" "git revert --no-commit HEAD"
check "'git revert --no-commit' on main allowed (round2 fix 3)" 0

run_hook "$MAIN_REPO" "git revert -n HEAD"
check "'git revert -n' on main allowed (round2 fix 3)" 0

run_hook "$MAIN_REPO" "git revert HEAD"
check "'git revert' WITHOUT --no-commit/-n on main still blocked (round2 fix 3)" 2

run_hook "$MAIN_REPO" "git merge --no-commit feat/some-work"
check "'git merge --no-commit' on main allowed (round2 fix 3)" 0

run_hook "$MAIN_REPO" "git merge feat/some-work"
check "'git merge' WITHOUT --no-commit on main still blocked (round2 fix 3)" 2

# A quoted --no-commit inside a commit message must not smuggle the
# exemption for an actual mutating merge/revert in the same segment.
run_hook "$MAIN_REPO" "git revert -m 'faking --no-commit' HEAD"
check "quoted '--no-commit' text does not smuggle the revert exemption (round2 fix 3)" 2

# =====================================================================
# ROUND2 FIX 4: the BLOCKED message must name the SPECIFIC git subcommand
# that triggered the block, not a generic "commit-creating git operation".
# =====================================================================
run_hook "$MAIN_REPO" "$GC -m 'msg'"
case "$HOOK_STDERR" in
  *"'git commit'"*) PASS=$((PASS + 1)); echo "ok: BLOCKED message names 'git commit' (round2 fix 4)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: BLOCKED message does not name 'git commit' (round2 fix 4): $HOOK_STDERR" ;;
esac

run_hook "$MAIN_REPO" "git merge feat/some-work"
case "$HOOK_STDERR" in
  *"'git merge'"*) PASS=$((PASS + 1)); echo "ok: BLOCKED message names 'git merge' (round2 fix 4)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: BLOCKED message does not name 'git merge' (round2 fix 4): $HOOK_STDERR" ;;
esac

run_hook "$MAIN_REPO" "git cherry-pick abc123"
case "$HOOK_STDERR" in
  *"'git cherry-pick'"*) PASS=$((PASS + 1)); echo "ok: BLOCKED message names 'git cherry-pick' (round2 fix 4)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: BLOCKED message does not name 'git cherry-pick' (round2 fix 4): $HOOK_STDERR" ;;
esac

run_hook "$MAIN_REPO" "git revert HEAD"
case "$HOOK_STDERR" in
  *"'git revert'"*) PASS=$((PASS + 1)); echo "ok: BLOCKED message names 'git revert' (round2 fix 4)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: BLOCKED message does not name 'git revert' (round2 fix 4): $HOOK_STDERR" ;;
esac

run_hook "$MAIN_REPO" "git pull"
case "$HOOK_STDERR" in
  *"'git pull'"*) PASS=$((PASS + 1)); echo "ok: BLOCKED message names 'git pull' (round2 fix 4)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: BLOCKED message does not name 'git pull' (round2 fix 4): $HOOK_STDERR" ;;
esac

run_hook "$MAIN_REPO" "git stash pop"
case "$HOOK_STDERR" in
  *"'git stash pop'"*) PASS=$((PASS + 1)); echo "ok: BLOCKED message names 'git stash pop' (round2 fix 4)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: BLOCKED message does not name 'git stash pop' (round2 fix 4): $HOOK_STDERR" ;;
esac

# Existing substring-based assertions from earlier rounds must still hold
# after the message-wording change (BLOCKED / pending branch / $MAIN_REPO
# resolving-context phrasing is untouched).
run_hook "$MAIN_REPO" "$GC -m 'msg'"
case "$HOOK_STDERR" in
  *BLOCKED*) PASS=$((PASS + 1)); echo "ok: BLOCKED substring still present after fix 4 wording change" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: BLOCKED substring missing after fix 4 wording change" ;;
esac

run_hook "$FEAT_REPO" "git checkout main && $GC -m 'msg'"
case "$HOOK_STDERR" in
  *"pending branch"*) PASS=$((PASS + 1)); echo "ok: 'pending branch' substring still present after fix 4 wording change" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: 'pending branch' substring missing after fix 4 wording change" ;;
esac

run_hook "$FEAT_REPO" "git -C $MAIN_REPO commit -m 'msg'"
case "$HOOK_STDERR" in
  *"$MAIN_REPO"*) PASS=$((PASS + 1)); echo "ok: \$MAIN_REPO substring still present after fix 4 wording change" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: \$MAIN_REPO substring missing after fix 4 wording change" ;;
esac

# =====================================================================
# ROUND2 FIX 5: GIT_WORK_TREE=<dir> env-prefix work-tree redirection had
# ZERO test coverage even though the --work-tree flag forms were tested.
# The hook's regex already handles this form; this closes the gap.
# =====================================================================
run_hook "$FEAT_REPO" "GIT_WORK_TREE=$MAIN_REPO $GC -m 'msg'"
check "GIT_WORK_TREE=<main checkout> commit blocked (round2 fix 5)" 2

run_hook "$MAIN_REPO" "GIT_WORK_TREE=$FEAT_REPO $GC -m 'msg'"
check "GIT_WORK_TREE=<feature checkout> commit allowed (round2 fix 5)" 0

# =====================================================================
# ROUND 3 (PF-995 / #8988, review round 3): quote-aware segment SPLITTING
# (separators inside quotes are inert), `&`/`|` as segment separators,
# unattributed-commit fallback hardening, and two-arg `branch -M/-m`.
# =====================================================================

# --- ROUND3 FIX 1/2: the segment SPLITTER (not just the classifier) must be
# --- quote-aware AND split on a single `&` (background) / `|` (pipe). The
# --- security repro: a real commit in a feature dir via `git -C`, then a
# --- background/pipe-separated switch-to-main or branch-rename followed by a
# --- payload commit that lands on main. Each must BLOCK (exit 2). ---

# (a) `&& ... & git commit` — the payload commit is its own segment after the
# splitter honours the single `&`, resolves to $PWD (main), and blocks.
run_hook "$MAIN_REPO" "git -C $FEAT_REPO commit -m ok && git checkout main & git commit -m payload"
check "background-'&' separated payload commit on main blocked (round3 fix 1/2, security repro a)" 2

# (b) payload commit piped (`|`) — the pipe is now a segment separator, so the
# payload commit is isolated and resolves to $PWD (main).
run_hook "$MAIN_REPO" "git -C $FEAT_REPO commit -m ok && git commit -m payload | git switch feat/x"
check "pipe-'|' separated payload commit on main blocked (round3 fix 1/2, security repro b)" 2

# (c) `& git branch -M main & git commit` — one-arg rename to main pends $PWD,
# the following payload commit resolves to it and blocks.
run_hook "$MAIN_REPO" "git -C $FEAT_REPO commit -m ok && git branch -M main & git commit -m payload"
check "background-'&' branch -M main then payload commit on main blocked (round3 fix 1/2, security repro c)" 2

# The splitter must NOT split on separators INSIDE quotes: a quoted commit
# message containing `&`, `|`, `;` is inert and must not form a pseudo-segment
# that flips the verdict. On a feature branch these stay allowed.
run_hook "$FEAT_REPO" "$GC -m 'fixes a & b | c ; done'"
check "quoted separators in a commit message are inert; feature-branch commit allowed (round3 fix 1)" 0

# A payload `git commit` buried INSIDE a quoted value can never form its own
# segment (the whole quoted span is one inert token) — on a feature branch the
# real outer commit is what counts, and it is allowed.
run_hook "$FEAT_REPO" "$GC -m 'run git commit && git commit on main'"
check "'git commit' inside a quoted message is inert, not a pseudo-segment; feature commit allowed (round3 fix 1)" 0

# --- ROUND3 FIX 3: the $PWD fallback must ALSO fire for a commit that rode
# --- inside a switch/branch segment (hidden in `$(...)`) and was never
# --- attributed — EVEN WHEN an earlier benign (non-main) target was already
# --- recorded. A benign target from one segment must not suppress the
# --- fallback for a later unattributed commit. ---
run_hook "$MAIN_REPO" "git -C $FEAT_REPO commit -m ok && git checkout feat/existing \$(git commit -m payload)"
check "unattributed commit in a switch segment still checked despite earlier benign target; blocked on main (round3 fix 3)" 2

# The mirror must NOT over-block: a legitimate switch+commit chain from a
# feature cwd with NO hidden commit stays allowed (the fallback only fires when
# a commit actually rides the switch segment).
run_hook "$FEAT_REPO" "git -C $FEAT_REPO commit -m ok && git checkout feat/existing && $GC -m 'msg'"
check "benign switch+commit chain on feature branch not over-blocked by fallback hardening (round3 fix 3)" 0

# --- ROUND3 FIX 4: two-argument `git branch -M <old> <new>` / `-m <old> <new>`
# --- renaming to main/master. Pends ONLY when <old> is the effective dir's
# --- current branch; renaming some OTHER branch to main does not move HEAD. ---

# Positive: rename the CURRENT branch to main → following commit blocked.
run_hook "$FEAT_REPO" "git branch -M feat/some-work main && $GC -m 'msg'"
check "'git branch -M <current> main' (two-arg) then commit blocked (round3 fix 4, -M positive)" 2

run_hook "$FEAT_REPO" "git branch -m feat/some-work master && $GC -m 'msg'"
check "'git branch -m <current> master' (two-arg) then commit blocked (round3 fix 4, -m positive)" 2

# Positive with a `git -C <dir>` directory flag ahead of the rename.
run_hook "$MAIN_REPO" "git -C $FEAT_REPO branch -M feat/some-work main && git -C $FEAT_REPO commit -m 'msg'"
check "'git -C <dir> branch -M <current> main' (two-arg) then commit on that dir blocked (round3 fix 4, -C form)" 2

# Negative: renaming some OTHER (non-current) branch to main does not move HEAD
# — the following commit stays on the feature branch and is allowed.
run_hook "$FEAT_REPO" "git branch -M feat/other main && $GC -m 'msg'"
check "'git branch -M <other-branch> main' (two-arg) does not pend; commit still allowed (round3 fix 4, negative)" 0

# Fail-closed: when the effective directory's current branch cannot be resolved
# (nonexistent dir / not a repo), a two-arg rename to main is treated as
# renaming the current branch and pends → the commit on that dir blocks.
run_hook "$FEAT_REPO" "git -C /nonexistent-dir-xyz-789 branch -M whatever main && git -C /nonexistent-dir-xyz-789 commit -m 'msg'"
check "two-arg rename to main with unresolvable current branch fails closed; commit blocked (round3 fix 4, fail-closed)" 2

# --- ROUND3 FIX 5: `git switch -` (previous-branch shorthand) to a FEATURE
# --- branch must be allowed — mirror of the existing `checkout -` allow case.
# --- PREV_FEAT_REPO has HEAD on main with @{-1} == feat/z. ---
run_hook "$PREV_FEAT_REPO" "git switch - && $GC -m 'msg'"
check "'switch -' back to a feature branch then commit allowed (round3 fix 5, mirror of checkout -)" 0

# =====================================================================
# ROUND 4 (PF-995 / #8988, review round 4): the round-3 splitter collapsed
# EVERY separator to a newline, erasing the success-dependency between
# segments. A recorded plain `git checkout/switch <feature>` must only be
# TRUSTED to have taken effect before a following commit across a
# guaranteed-success `&&` chain; across any other link (`;`, `||`, `|`, `&`,
# newline) the switch may not have run, may have failed, or is unordered, so
# the following commit must fall through to the live $PWD lookup (main → block).
# =====================================================================

# --- ROUND4 FINDING 1/2: separator-type-aware trust. From a MAIN checkout, a
# --- plain switch to a (nonexistent) feature branch linked to a following
# --- commit by anything OTHER than `&&` must NOT launder the commit onto that
# --- pending feature branch — it stays on main and blocks (exit 2). ---
run_hook "$MAIN_REPO" "git checkout feat/nonexistent-x ; $GC -m 'payload'"
check "checkout <feature> ';' commit does not inherit switch trust across a non-&& link; blocked on main (round4 finding 1, semicolon)" 2

run_hook "$MAIN_REPO" "git checkout feat/nonexistent-x || $GC -m 'payload'"
check "checkout <feature> '||' commit runs BECAUSE the switch failed; blocked on main (round4 finding 1, double-pipe)" 2

run_hook "$MAIN_REPO" "git switch feat/nonexistent-x | $GC -m 'payload'"
check "switch <feature> '|' commit is unordered w.r.t. the switch; blocked on main (round4 finding 1, single-pipe)" 2

run_hook "$MAIN_REPO" "git switch feat/nonexistent-x & $GC -m 'payload'"
check "switch <feature> '&' background commit has no ordering guarantee; blocked on main (round4 finding 1, single-ampersand)" 2

# --- ROUND4 FINDING 2: the legitimate `&&` allows MUST stay green — trust
# --- propagates across a guaranteed-success chain, so a new-branch or
# --- existing-feature switch followed by `&& commit` is allowed on main. ---
run_hook "$MAIN_REPO" "git checkout -b feat/new-r4 && $GC -m 'msg'"
check "checkout -b then '&&' commit still allowed on main (round4 finding 2, legit && new branch)" 0

run_hook "$MAIN_REPO" "git checkout feat/existing && $GC -m 'msg'"
check "checkout <existing feature> then '&&' commit still allowed on main (round4 finding 2, legit && plain switch)" 0

# --- ROUND4 FINDING 3: the whole-command prefilter is not quote-aware, so a
# --- benign command whose only "git commit" text sits inside a quoted string
# --- (run from a MAIN checkout) passes the prefilter yet resolves no real
# --- target. That must ALLOW (exit 0) — EXCEPT fail closed when the
# --- quote-stripped skeleton hands a payload to a nested shell interpreter. ---
run_hook "$MAIN_REPO" 'echo "remember to git commit later"'
check "benign echo with quoted 'git commit' not false-blocked on main (round4 finding 3, allow)" 0

run_hook "$MAIN_REPO" "jq -nc --arg c 'see git commit here' '{}'"
check "jq --arg with quoted 'git commit' payload, no real git segment, allowed on main (round4 finding 3, allow)" 0

run_hook "$MAIN_REPO" "bash -c 'echo hi && git commit -m x'"
check "nested interpreter with quoted 'git commit' payload fails closed; blocked on main (round4 finding 3, nested interp)" 2

run_hook "$MAIN_REPO" "eval 'echo hi && git commit -m x'"
check "eval with quoted 'git commit' payload fails closed; blocked on main (round4 finding 3, eval)" 2

run_hook "$MAIN_REPO" "$GC -m x"
check "bare unquoted 'git commit' on main still blocked (round4 finding 3, control)" 2

# --- ROUND4 FINDING 4: coverage parity for the branch-rename-segment
# --- UNATTRIBUTED guard (hook ~362), mirroring the switch-segment pair. A
# --- commit-creating subcommand hidden in a branch-rename segment (via
# --- `$(...)`) must force the $PWD fallback (block on main), and the mirror
# --- must NOT over-block a benign rename+commit chain. ---
run_hook "$MAIN_REPO" "git -C $FEAT_REPO commit -m ok && git branch -M feat/x \$(git commit -m payload)"
check "unattributed commit hidden in a branch-rename segment forces \$PWD fallback; blocked on main (round4 finding 4, rename guard)" 2

run_hook "$FEAT_REPO" "git -C $FEAT_REPO commit -m ok && git branch -M feat/renamed && $GC -m 'msg'"
check "benign branch-rename+commit chain on feature branch not over-blocked by rename guard (round4 finding 4, non-over-block mirror)" 0

# --- ROUND5 FINDING 1: the whole-command prefilter's leading boundary class
# --- omitted the quote and backtick characters, so a nested-interpreter payload
# --- whose text BEGINS with `git commit` (git abutting the opening quote) never
# --- matched the prefilter and the hook exited 0 at the very first gate — BEFORE
# --- the round-4 NESTED_INTERP fail-closed machinery could ever run. All of the
# --- following landed commits on main pre-fix; they must now BLOCK (exit 2). ---
run_hook "$MAIN_REPO" "bash -c \"$GC -m x\""
check "bash -c with DOUBLE-quoted payload beginning with git commit blocked on main (round5 finding 1, dq abutting)" 2

run_hook "$MAIN_REPO" "bash -c '$GC -m x'"
check "bash -c with SINGLE-quoted payload beginning with git commit blocked on main (round5 finding 1, sq abutting)" 2

run_hook "$MAIN_REPO" "sh -c \"$GC -m x\""
check "sh -c with quoted payload beginning with git commit blocked on main (round5 finding 1, sh -c)" 2

run_hook "$MAIN_REPO" "eval \"$GC -m x\""
check "eval with quoted payload beginning with git commit blocked on main (round5 finding 1, eval abutting)" 2

run_hook "$MAIN_REPO" "bash -euo pipefail -c \"$GC -m x\""
check "option-hop bash -euo pipefail -c quoted git commit blocked on main (round5 finding 1, option hop)" 2

run_hook "$MAIN_REPO" "\`$GC -m x\`"
check "backtick command-substitution containing git commit blocked on main (round5 finding 1, backtick abutting)" 2

# --- ROUND5 FINDING 2: the widened prefilter now also matches benign quoted
# --- mentions where git abuts the quote, but with NO nested interpreter the
# --- NESTED_INTERP fallback never fires, so these must still ALLOW (exit 0). ---
run_hook "$MAIN_REPO" "echo \"$GC now\""
check "benign echo, git abuts quote, no interpreter, allowed on main (round5 finding 2, echo abutting allow)" 0

run_hook "$MAIN_REPO" "printf '%s' '$GC here'"
check "benign printf, git abuts single-quote, no interpreter, allowed on main (round5 finding 2, printf abutting allow)" 0

run_hook "$MAIN_REPO" "jq -nc --arg c '$GC here' '{}'"
check "benign jq --arg, git abuts single-quote, no interpreter, allowed on main (round5 finding 2, jq abutting allow)" 0

# =====================================================================
# ROUND 6 (PF-995 / #8989, review round 6): MUTATE_SUB's TRAILING boundary
# class ([[:space:]]|[;&|()]|$) omitted the quote and backtick characters —
# the mirror image of the round-5 LEADING-class gap. When a mutate subcommand
# is the LAST token before a closing quote/backtick (BARE form, no trailing
# args), the char after the subcommand is a quote/backtick, MUTATE_SUB fails,
# GIT_MUTATE_RE fails, and the hook exits 0 (allow) at the very first gate —
# BEFORE split_segments and the round-4 NESTED_INTERP fail-closed machinery.
# The round-5 masking pattern repeats on the closing side: every earlier
# payload pads the subcommand with a trailing " -m x"/args, so the subcommand
# is NEVER quote-adjacent on the closing side. These BARE forms (NO trailing
# args) landed real commits on main pre-fix; they must now BLOCK (exit 2).
# =====================================================================
run_hook "$MAIN_REPO" "bash -c \"$GC\""
check "bash -c DOUBLE-quoted BARE git commit (subcmd abuts closing quote) blocked on main (round6 finding 1, bash dq bare)" 2

run_hook "$MAIN_REPO" "bash -c '$GC'"
check "bash -c SINGLE-quoted BARE git commit blocked on main (round6 finding 1, bash sq bare)" 2

run_hook "$MAIN_REPO" "sh -c \"$GC\""
check "sh -c DOUBLE-quoted BARE git commit blocked on main (round6 finding 1, sh -c bare)" 2

run_hook "$MAIN_REPO" "zsh -c \"$GC\""
check "zsh -c DOUBLE-quoted BARE git commit blocked on main (round6 finding 1, zsh -c bare)" 2

run_hook "$MAIN_REPO" "eval \"$GC\""
check "eval DOUBLE-quoted BARE git commit blocked on main (round6 finding 1, eval bare)" 2

run_hook "$MAIN_REPO" "bash -euo pipefail -c \"$GC\""
check "option-hop bash -euo pipefail -c BARE git commit blocked on main (round6 finding 1, option hop bare)" 2

run_hook "$MAIN_REPO" "\`$GC\`"
check "backtick-wrapped BARE git commit (subcmd abuts closing backtick) blocked on main (round6 finding 1, backtick bare)" 2

run_hook "$MAIN_REPO" "sh -c \"git merge\""
check "sh -c DOUBLE-quoted BARE git merge blocked on main (round6 finding 1, sh merge bare)" 2

run_hook "$MAIN_REPO" "sh -c \"git pull\""
check "sh -c DOUBLE-quoted BARE git pull blocked on main (round6 finding 1, sh pull bare)" 2

# --- ROUND6 FINDING 1 (detect_subcmd lockstep): the newly-blocked BARE forms
# --- reach the $PWD fallback, whose BLOCKED message names the subcommand via
# --- detect_subcmd. Its per-subcommand (line 123) and stash-pop (line 128)
# --- regexes carry the SAME trailing class and must widen in lockstep, or a
# --- bare `git merge` blocks with an UNNAMED subcommand (defaults to 'commit')
# --- — a ux regression. Assert the message names the REAL subcommand. ---
run_hook "$MAIN_REPO" "sh -c \"git merge\""
case "$HOOK_STDERR" in
  *"'git merge'"*) PASS=$((PASS + 1)); echo "ok: BARE 'git merge' BLOCKED message names the real subcommand (round6 finding 1, detect_subcmd lockstep)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: BARE 'git merge' BLOCKED message does not name 'git merge' (round6 finding 1, detect_subcmd lockstep): $HOOK_STDERR" ;;
esac

# --- ROUND6 FINDING 2: the widened trailing class also newly matches benign
# --- quoted mentions where the subcommand abuts the CLOSING quote, but with NO
# --- nested interpreter the NESTED_INTERP fallback never fires, so these stay
# --- ALLOWED (exit 0) — mirror of the round-5 opening-side benign allows. ---
run_hook "$MAIN_REPO" "echo \"remember to $GC\""
check "benign echo, git commit abuts CLOSING quote, no interpreter, allowed on main (round6 finding 2, echo closing allow)" 0

run_hook "$MAIN_REPO" "printf '%s' 'remember to $GC'"
check "benign printf, git commit abuts CLOSING single-quote, no interpreter, allowed on main (round6 finding 2, printf closing allow)" 0

# --- ROUND6 FINDING 2 (feature-branch symmetry): the BARE nested-interp form
# --- must mirror the PADDED form's cwd-resolved verdict — the fail-closed
# --- $PWD fallback resolves against the feature-branch cwd, so it is allowed
# --- (exactly as `bash -c "git commit -m x"` from a feature repo is allowed). ---
run_hook "$FEAT_REPO" "bash -c \"$GC\""
check "bash -c BARE git commit from a feature-branch cwd allowed (round6 finding 2, feature-branch symmetry)" 0

# =====================================================================
# ROUND 7 (PF-995 / #8989, review round 6): the enumerated boundary
# classes at GIT_CMD (leading) and SUB_END (trailing) still omitted whole
# families of separators — every prior round added one more character and
# the next review found the next gap. Round 7 INVERTS both classes to
# NEGATED word-char classes (`[^[:alnum:]_.-]`) and adds a normalized
# prefilter copy (backslash/quote/backtick-stripped) plus command-
# substitution-as-executor detection. Redirects (`>`,`<`,`>>`,`>&`),
# backslash, path-slash, and escaped-quote forms all become boundaries or
# match the normalized copy automatically. These BARE/redirect/escaped
# forms landed real commits on main pre-fix; they must now BLOCK (exit 2).
# =====================================================================

# --- FIX A: redirect operators abutting a mutate subcommand (no space) are
# --- boundaries under the negated trailing class. TOP-LEVEL, no nesting. ---
run_hook "$MAIN_REPO" "$GC>out.txt"
check "commit abutting '>out.txt' redirect blocked on main (round7 fix A, stdout redirect)" 2

run_hook "$MAIN_REPO" "$GC<in.txt"
check "commit abutting '<in.txt' redirect blocked on main (round7 fix A, stdin redirect)" 2

run_hook "$MAIN_REPO" "$GC>>out.txt"
check "commit abutting '>>out.txt' append redirect blocked on main (round7 fix A, append)" 2

run_hook "$MAIN_REPO" "$GC>&2"
check "commit abutting '>&2' fd redirect blocked on main (round7 fix A, fd dup)" 2

# The same redirect form inside a nested-interpreter payload must block too.
run_hook "$MAIN_REPO" 'bash -c "git commit>out.txt"'
check "redirect-abutting git commit inside bash -c payload blocked on main (round7 fix A, nested redirect)" 2

# --- FIX A (path-invoked): `/` is a boundary under the negated leading class,
# --- so an absolute-path-invoked git newly prefilter-matches (bonus catch). ---
run_hook "$MAIN_REPO" "/usr/bin/git commit"
check "path-invoked '/usr/bin/git commit' blocked on main (round7 fix A, path slash boundary)" 2

# --- FIX B: escaped-quote forms defeat RAW matching; the normalized copy
# --- (backslash/quote/backtick-stripped) routes them into the pipeline. ---
run_hook "$MAIN_REPO" 'bash -c "eval \"git commit\""'
check "bash -c with escaped-inner-quote eval payload blocked on main (round7 fix B, escaped nested eval)" 2

run_hook "$MAIN_REPO" 'sh -c "\"git\" commit"'
check "sh -c with escaped-quote-around-git payload blocked on main (round7 fix B, leading escaped quote)" 2

# --- FIX C: command substitution EXECUTES inside double quotes, so a
# --- double-quoted `$(...)` / backtick around a mutate is a nested executor. ---
run_hook "$MAIN_REPO" "\"\$(git commit)\""
check "double-quoted command substitution \"\$(git commit)\" blocked on main (round7 fix C, dollar-paren)" 2

run_hook "$MAIN_REPO" "\"\`git commit\`\""
check "double-quoted backtick substitution blocked on main (round7 fix C, backtick in quotes)" 2

# --- ROUND7 message quality: a redirect-abutting or normalized-only block
# --- must still NAME the real subcommand via detect_subcmd's normalized
# --- fallback. ---
run_hook "$MAIN_REPO" "$GC>out.txt"
case "$HOOK_STDERR" in
  *"'git commit'"*) PASS=$((PASS + 1)); echo "ok: redirect-abutting block names 'git commit' (round7 message quality)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: redirect-abutting block does not name 'git commit' (round7 message quality): $HOOK_STDERR" ;;
esac

run_hook "$MAIN_REPO" 'sh -c "\"git\" merge"'
check "normalized-only sh -c escaped-quote git merge blocked on main (round7 fix B, merge)" 2
case "$HOOK_STDERR" in
  *"'git merge'"*) PASS=$((PASS + 1)); echo "ok: normalized-only block names the real subcommand 'git merge' (round7 detect_subcmd normalized fallback)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: normalized-only block does not name 'git merge' (round7 detect_subcmd normalized fallback): $HOOK_STDERR" ;;
esac

# --- ROUND7 allow mirrors (over-block guards) ---

# Single-quoted command substitution is INERT — it is collapsed before the
# `$(` scan, so it must NOT set the nested-executor flag: allowed on main.
run_hook "$MAIN_REPO" "echo 'see \$(git commit)'"
check "single-quoted inert \$(git commit) not false-blocked on main (round7 fix C, single-quote inert allow)" 0

# `git commit-tree` is plumbing (does not commit to a branch); the hyphen must
# stay a word char so the negated trailing class does NOT treat it as a bare
# `commit` subcommand: allowed on main.
run_hook "$MAIN_REPO" "git commit-tree"
check "'git commit-tree' plumbing (hyphen is a word char) not blocked on main (round7 fix A, hyphen word char)" 0

# A redirect-abutting commit on a FEATURE branch must be allowed — attribution,
# not syntax, decides. The prefilter now matches it, but $PWD resolves to the
# feature branch.
run_hook "$FEAT_REPO" "$GC>log.txt"
check "redirect-abutting git commit on a feature branch allowed (round7 fix A, feature-branch symmetry)" 0

# The nested-executor / command-substitution forms mirror the padded verdict on
# a feature-branch cwd — the fail-closed $PWD fallback resolves to the feature
# branch, so allowed.
run_hook "$FEAT_REPO" "\"\$(git commit)\""
check "double-quoted command substitution from a feature-branch cwd allowed (round7 fix C, feature-branch symmetry)" 0

# --- ROUND8 fix: empty-quote concatenation bypass (PF-995 / #8988) ---
# An EMPTY quoted pair ("" or '') contributes nothing to a word in real shell,
# so `""git commit` executes as a plain `git commit`. The seg_class / classifier
# collapse turned an empty pair into the placeholder X and GLUED it to the next
# word (`""git` -> `Xgit`), destroying git's leading word boundary and letting a
# REAL commit land on main (exit 0). Empirically verified against real bash in
# the round8-build-fixtures fixture: `""git commit`, `''git commit`,
# `git ""commit`, `""''git commit`, `''""git commit`, `""git merge` all invoke
# real git with the subcommand; `git"x"commit` glues to ONE word `gitxcommit`
# (NOT a git invocation); `git commit -m ""` is a real commit.

# Blocking (exit 2) from a main checkout — the confirmed live bypasses.
run_hook "$MAIN_REPO" "\"\"$GC -m x"
check "empty double-quote prefix '\"\"git commit -m x' blocked on main (round8 empty-pair bypass)" 2
case "$HOOK_STDERR" in
  *"'git commit'"*) PASS=$((PASS + 1)); echo "ok: empty-pair block names 'git commit' (round8 message quality)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: empty-pair block does not name 'git commit' (round8 message quality): $HOOK_STDERR" ;;
esac

run_hook "$MAIN_REPO" "''$GC -m x"
check "empty single-quote prefix \"''git commit -m x\" blocked on main (round8 empty-pair bypass)" 2

run_hook "$MAIN_REPO" "\"\"$GC"
check "bare empty double-quote prefix '\"\"git commit' blocked on main (round8 empty-pair bare)" 2

run_hook "$MAIN_REPO" "\"\"''$GC -m x"
check "interleaved empties '\"\"''git commit -m x' blocked on main (round8 interleaved empty)" 2

run_hook "$MAIN_REPO" "''\"\"$GC"
check "interleaved empties \"''\"\"git commit\" blocked on main (round8 interleaved empty, other order)" 2

run_hook "$MAIN_REPO" "\"\"git merge"
check "empty double-quote prefix '\"\"git merge' blocked on main (round8 empty-pair, second subcommand)" 2

run_hook "$MAIN_REPO" "git \"\"commit -m x"
check "empty pair mid-invocation 'git \"\"commit -m x' blocked on main (round8 empty-pair glues to commit)" 2

run_hook "$MAIN_REPO" "$GC -m \"\""
check "empty-message 'git commit -m \"\"' still blocked on main (round8 empty arg is a real commit)" 2

# Allow (exit 0) mirrors — empty pairs with no git mutate, and X-gluing preserved.
run_hook "$MAIN_REPO" "echo \"\""
check "'echo \"\"' (empty pair, no git) allowed on main (round8 allow mirror)" 0

run_hook "$MAIN_REPO" "echo \"\" git-commit-free text"
check "'echo \"\" git-commit-free text' (no git<sp>commit) allowed on main (round8 allow mirror)" 0

run_hook "$MAIN_REPO" "git\"x\"commit"
check "glued non-invocation 'git\"x\"commit' (X-gluing preserved) allowed on main (round8 non-empty stays glued)" 0

run_hook "$MAIN_REPO" "echo \"$GC\""
check "'echo \"git commit\"' benign quoted inert allowed on main (round8 benign-quoted allow)" 0

# FEATURE-branch mirror: attribution decides, not syntax — empty-pair prefix allows.
run_hook "$FEAT_REPO" "\"\"$GC -m x"
check "empty double-quote prefix '\"\"git commit -m x' on a feature branch allowed (round8 attribution)" 0
# --- ROUND 9: non-empty quoted / backslash / ANSI-C reduction of the git or
# --- subcommand token in COMMAND position (PF-995 / #8988 findings 1 & 2).
# The classifier collapses every NON-EMPTY quoted span to a placeholder X and
# never strips backslash or `$'...'` ANSI-C quoting, so a command that STATICALLY
# reduces (pure quote/backslash removal, no runtime var/subshell) to `git <mutate>`
# in command position slipped the segment classifier while real bash strips the
# quoting and lands a REAL commit on main. Verified against real bash in the
# round9-build-fixtures fixture: `"git" commit`, `git "commit"`, `git 'commit'`,
# `'git' commit`, `"git" "commit"`, `g\it commit`, `\g\i\t commit`, `git \commit`,
# `$'git' commit`, `git $'commit' -m x`, `"git" \commit`, and `"git" merge` all
# invoke real git with the subcommand; `git"x"commit` / `g"x"it commit` concatenate
# adjacent spans into ONE non-git word; `echo "git commit"` / `echo "git" "commit"`
# / `printf "%s" "git commit"` keep git out of command position (benign mention).

# Blocking (exit 2) from a main checkout — the confirmed live bypasses.
run_hook "$MAIN_REPO" "\"git\" commit -m x"
check "quoted git word '\"git\" commit -m x' blocked on main (round9 finding 1)" 2
case "$HOOK_STDERR" in
  *"'git commit'"*) PASS=$((PASS + 1)); echo "ok: quoted-git-word block names 'git commit' (round9 message quality)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: quoted-git-word block does not name 'git commit' (round9): $HOOK_STDERR" ;;
esac

run_hook "$MAIN_REPO" "git \"commit\" -m x"
check "quoted subcommand 'git \"commit\" -m x' blocked on main (round9 finding 1)" 2

run_hook "$MAIN_REPO" "git 'commit' -m x"
check "single-quoted subcommand \"git 'commit' -m x\" blocked on main (round9 finding 1)" 2

run_hook "$MAIN_REPO" "'git' commit"
check "single-quoted git word \"'git' commit\" blocked on main (round9 finding 1)" 2

run_hook "$MAIN_REPO" "\"git\" \"commit\""
check "both quoted '\"git\" \"commit\"' blocked on main (round9 finding 1)" 2

run_hook "$MAIN_REPO" "g\it commit -m x"
check "backslash-escaped git word 'g\\it commit -m x' blocked on main (round9 finding 2)" 2

run_hook "$MAIN_REPO" "\g\i\t commit -m x"
check "fully backslash-escaped git word '\\g\\i\\t commit -m x' blocked on main (round9 finding 2)" 2

run_hook "$MAIN_REPO" "git \commit -m x"
check "backslash-escaped subcommand 'git \\commit -m x' blocked on main (round9 finding 2)" 2

run_hook "$MAIN_REPO" "\$'git' commit -m x"
check "ANSI-C git word \"\$'git' commit -m x\" blocked on main (round9 finding 2)" 2

run_hook "$MAIN_REPO" "git \$'commit' -m x"
check "ANSI-C subcommand \"git \$'commit' -m x\" blocked on main (round9 finding 2)" 2

run_hook "$MAIN_REPO" "\"git\" \commit -m x"
check "mixed quote+backslash '\"git\" \\commit -m x' blocked on main (round9 combined)" 2

run_hook "$MAIN_REPO" "\"git\" merge"
check "quoted git word '\"git\" merge' blocked on main (round9 second subcommand)" 2
case "$HOOK_STDERR" in
  *"'git merge'"*) PASS=$((PASS + 1)); echo "ok: quoted-git-word merge block names 'git merge' (round9 message quality)" ;;
  *) FAIL=$((FAIL + 1)); echo "FAIL: quoted-git-word merge block does not name 'git merge' (round9): $HOOK_STDERR" ;;
esac

# Allow (exit 0) mirrors — the discriminator: git NOT in command position, or
# adjacent non-empty spans concatenate into a single non-git word.
run_hook "$MAIN_REPO" "echo 'git commit'"
check "\"echo 'git commit'\" benign single-quoted mention allowed on main (round9 discriminator)" 0

run_hook "$MAIN_REPO" "printf \"%s\" \"git commit\""
check "'printf \"%s\" \"git commit\"' benign quoted arg allowed on main (round9 discriminator)" 0

run_hook "$MAIN_REPO" "g\"x\"it commit"
check "glued non-invocation 'g\"x\"it commit' (spans concatenate, not git) allowed on main (round9 discriminator)" 0

run_hook "$MAIN_REPO" "echo \"git\" \"commit\""
check "'echo \"git\" \"commit\"' (echo args, git not command-position) allowed on main (round9 discriminator)" 0

# Runtime indirection stays out of scope (fail-open) — a target assembled from a
# shell VARIABLE does not reduce statically, so it is allowed by design.
run_hook "$MAIN_REPO" "x=git; \$x commit"
check "runtime-indirection 'x=git; \$x commit' allowed on main (round9 documented fail-open)" 0

# FEATURE-branch mirror: attribution decides, not syntax — the same quoted /
# escaped forms that block on main are allowed on a feature branch.
run_hook "$FEAT_REPO" "\"git\" commit -m x"
check "quoted git word '\"git\" commit -m x' on a feature branch allowed (round9 attribution)" 0

run_hook "$FEAT_REPO" "g\it commit -m x"
check "backslash-escaped git word 'g\\it commit -m x' on a feature branch allowed (round9 attribution)" 0

# --- ROUND 10 finding 1: backslash-newline LINE CONTINUATION between `git` and
# --- its subcommand. Real bash deletes the `\<NL>` during tokenization and runs
# --- `git commit` — a REAL commit lands on main (verified by execution). The
# --- pre-pass must join the physical lines BEFORE segmentation so git+commit
# --- reconstruct in command position. (split_segments used to treat the literal
# --- newline as an `O` separator and split `git \` | `commit`, so neither half
# --- reduced to a mutation and the commit slipped.)
run_hook "$MAIN_REPO" "$(printf 'git \\\ncommit -m x')"
check "line-continuation 'git \\<NL>commit -m x' blocked on main (round10 finding 1)" 2

run_hook "$MAIN_REPO" "$(printf 'git \\\n commit -m x')"
check "line-continuation space-both-sides 'git \\<NL> commit -m x' blocked on main (round10 finding 1)" 2

# Non-regression: a continuation AFTER the subcommand still blocks (git+commit
# are already command-position adjacent; the pre-pass just joins the tail).
run_hook "$MAIN_REPO" "$(printf 'git commit \\\n-m x')"
check "continuation AFTER subcommand 'git commit \\<NL>-m x' still blocked on main (round10 non-regression)" 2

# Boundary: a `\<NL>` INSIDE a single-quoted span is LITERAL (bash does NOT
# treat it as a continuation there), so the pre-pass must leave it alone — yet a
# real `git commit` after the `;` still blocks. Verifies the pre-pass respects
# the single-quote boundary without opening a laundering hole.
run_hook "$MAIN_REPO" "$(printf "echo 'a\\\nb'; git commit")"
check "single-quoted '\\<NL>' literal, trailing 'git commit' still blocked on main (round10 squote boundary)" 2

# --- ROUND 10 finding 2: an escaped/quoted WORD-JOINING space. Real bash reads
# --- `git\ commit` as the SINGLE word `git commit` — a nonexistent command
# --- (rc 127); git is NEVER invoked (verified by execution). reduce_words must
# --- NOT emit the joining space as bare whitespace the anchored regex re-splits,
# --- or the hook over-blocks (a discriminator FAIL).
run_hook "$MAIN_REPO" "git\ commit -m x"
check "escaped word-joining space 'git\\ commit -m x' (single word, rc127) allowed on main (round10 finding 2)" 0

run_hook "$MAIN_REPO" "git\ commit"
check "bare escaped word-joining space 'git\\ commit' (single word, rc127) allowed on main (round10 finding 2)" 0

# The quoted-space forms are also word-joining (single word `git commit`, rc127,
# git never invoked — verified). These already allow at HEAD; they guard against
# a finding-2 fix regressing them.
run_hook "$MAIN_REPO" 'git" "commit'
check "double-quoted word-joining space 'git\" \"commit' (single word, rc127) allowed on main (round10 finding 2)" 0

run_hook "$MAIN_REPO" "git' 'commit"
check "single-quoted word-joining space \"git' 'commit\" (single word, rc127) allowed on main (round10 finding 2)" 0

# Do-not-regress: an UNQUOTED space between a reduced git and commit must STILL
# split and block (finding 2's fix must not reopen finding 1 / the round-9 class).
run_hook "$MAIN_REPO" "git commit -m x"
check "plain 'git commit -m x' (unquoted space) still blocked on main (round10 finding 2 guard)" 2

# FEATURE-branch mirror: the line-continuation form is allowed off main —
# attribution decides, not syntax.
run_hook "$FEAT_REPO" "$(printf 'git \\\ncommit -m x')"
check "line-continuation 'git \\<NL>commit -m x' on a feature branch allowed (round10 attribution)" 0

# --- ROUND 11 finding 1 (CRITICAL under-block): a single-quoted `\<NL>` line
# --- continuation fed to a NESTED interpreter. Round 10's pre-pass correctly
# --- PRESERVES a single-quoted `\<NL>` as literal to the OUTER shell (line 81),
# --- but the INNER shell that re-parses the `-c` payload deletes the continuation
# --- during ITS OWN tokenization and runs `git commit` — a REAL commit lands on
# --- main (verified by execution: HEAD advanced). The surviving literal newline
# --- also splits `git` from `commit` across two physical lines, so the line-based
# --- prefilter greps miss `git commit` and the hook exits 0 BEFORE the quote-aware
# --- pipeline (and its NESTED_INTERP fail-closed $PWD fallback) ever runs. The fix
# --- adds a continuation-stripped inner-shell view to the prefilter OR-chain so
# --- such a payload ROUTES into the pipeline, where NESTED_INTERP=1 + empty targets
# --- fail closed. The DOUBLE-quoted analogue already blocked at HEAD (guard below).
CONT_PAYLOAD="$(printf 'git \\\ncommit -m x')"   # git \<NL>commit -m x (backslash + real 0x0a)
run_hook "$MAIN_REPO" "sh -c '$CONT_PAYLOAD'"
check "single-quoted continuation in sh -c payload 'sh -c 'git \\<NL>commit'' blocked on main (round11 finding 1)" 2

run_hook "$MAIN_REPO" "bash -c '$CONT_PAYLOAD'"
check "single-quoted continuation in bash -c payload 'bash -c 'git \\<NL>commit'' blocked on main (round11 finding 1)" 2

# Non-regression guard: the DOUBLE-quoted nested-interpreter continuation already
# blocked at HEAD (its `\<NL>` is a live continuation to the OUTER shell too, so
# strip_line_continuations joined it pre-pipeline). The fix must not break it.
run_hook "$MAIN_REPO" "bash -c \"$CONT_PAYLOAD\""
check "double-quoted continuation in bash -c payload 'bash -c \"git \\<NL>commit\"' still blocked on main (round11 non-regression)" 2

# Do-NOT-regress the round-10 single-quote boundary: a BARE single-quoted
# continuation NOT fed to an interpreter is ONE literal word (`git\<NL>commit -m x`,
# an rc127 non-command; git never runs), so it must STILL ALLOW even though the new
# inner-shell prefilter view routes it into the pipeline. There it hits NESTED_INTERP=0
# (no interpreter/eval/substitution) so the fail-closed fallback never fires and no
# segment resolves a command-position git target.
run_hook "$MAIN_REPO" "'$CONT_PAYLOAD'"
check "bare single-quoted continuation \"'git \\<NL>commit -m x'\" (rc127 non-command) allowed on main (round11 boundary)" 0

# FEATURE-branch mirror: the nested-interpreter continuation form is allowed off
# main — attribution decides, not syntax.
run_hook "$FEAT_REPO" "sh -c '$CONT_PAYLOAD'"
check "single-quoted continuation in sh -c payload on a feature branch allowed (round11 attribution)" 0

# --- ROUND 11: `sh -c 'echo git commit'` — the inner payload MENTIONS git as an
# --- `echo` argument (git is NOT command-position; it never runs). By the CORRECT
# --- runtime contract this would ALLOW, but the hook's round-4/7 nested-interpreter
# --- posture is DELIBERATELY fail-CLOSED (lines 708-770): any `bash|sh -c`/`eval`
# --- with no statically-resolved git target blocks on $PWD, because distinguishing
# --- an echo-arg git from a command-position git INSIDE an arbitrary `-c` payload
# --- requires recursively re-classifying that payload — the same fail-closed rule
# --- that (correctly) blocks `eval "git commit"` (line 802) and `bash -c 'echo hi &&
# --- git commit'` (line 720). These block at HEAD and STILL block after the round-11
# --- prefilter fix (it only ROUTES more payloads into the pipeline; it does not relax
# --- the fallback). The round-11 finding lists these as ALLOW-desired — a SEPARATE,
# --- pre-existing, fail-SAFE over-block, surfaced to the reviewer as an open design
# --- item; fixing it (inner-payload re-classification) is out of scope for this tight
# --- CRITICAL-under-block hotfix and risks an under-block regression on lines 720/802.
run_hook "$MAIN_REPO" "sh -c 'echo git commit'"
check "'sh -c 'echo git commit'' fail-closed nested-interp block on main (round11 pre-existing over-block)" 2

run_hook "$MAIN_REPO" "sh -c 'echo \"git commit\"'"
check "'sh -c 'echo \"git commit\"'' fail-closed nested-interp block on main (round11 pre-existing over-block)" 2

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
