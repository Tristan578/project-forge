#!/bin/bash
# ============================================================================
# worktree-safety-commit.sh — Auto-save uncommitted work in worktrees
# ============================================================================
# Called by the Stop hook. If running in a worktree with uncommitted changes,
# creates a WIP commit so work is not lost on agent termination.
#
# This is a safety net — agents should still commit frequently per rule #10.

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$REPO_ROOT" ] && exit 0

# Only act if we're in a worktree (not the main repo)
MAIN_WORKTREE="$(git worktree list --porcelain 2>/dev/null | head -1 | sed 's/^worktree //')"
[ "$REPO_ROOT" = "$MAIN_WORKTREE" ] && exit 0

# Check for uncommitted changes (staged or unstaged)
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null || [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
  BRANCH="$(git branch --show-current 2>/dev/null)"
  git add -A 2>/dev/null
  git commit -m "wip: auto-save uncommitted work on agent stop (branch: ${BRANCH:-detached})

This is an automatic safety commit created because the agent was
terminated with uncommitted changes. Review and squash as needed." 2>/dev/null
fi

exit 0
