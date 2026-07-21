#!/bin/bash
# PreToolUse hook for Bash: block git commit on main/master.
# Agents (especially worktree agents) must use feature branches.
# Direct commits to main bypass CI/CD and Sentry review.
#
# The branch check must run in the directory the commit actually targets.
# Hooks execute with the SESSION's cwd — often the main checkout, parked on
# main — while agents commit inside `cd <worktree> && git commit` compound
# commands or via `git -C <dir> commit`. Checking the hook's own cwd would
# block every worktree commit whenever the main checkout sits on main
# (100% false-positive rate for the manual-worktree agent pattern).

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Matches `git commit` and `git -C <dir> commit` (bare, single- or
# double-quoted path). The bare `git\s+commit` form alone would let the
# -C form through unchecked.
GIT_COMMIT_RE='git[[:space:]]+(-C[[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+)[[:space:]]+)?commit'

# Only check git commit commands
if ! printf '%s' "$COMMAND" | grep -qE "$GIT_COMMIT_RE"; then
  exit 0
fi

# If the command also checks out a new branch before committing, allow it
# (e.g., "git checkout -b feat/xxx && git add . && git commit")
if printf '%s' "$COMMAND" | grep -qE 'git[[:space:]]+(checkout[[:space:]]+-b|switch[[:space:]]+-c)'; then
  exit 0
fi

# Strip surrounding single or double quotes from a path token.
unquote() {
  local s="$1"
  case "$s" in
    \"*\") s="${s%\"}"; s="${s#\"}" ;;
    \'*\') s="${s%\'}"; s="${s#\'}" ;;
  esac
  printf '%s' "$s"
}

# Walk the command's `&&`/`;`-chained segments in order, tracking `cd` so we
# know the working directory of each `git commit`. Splitting can mis-fire on
# `&&`/`;` inside quoted strings (e.g. a commit message); a bogus tracked dir
# then fails the branch lookup below and the hook fails OPEN — same posture
# as the existing malformed-stdin path. The PR-review flow is the backstop.
TRACKED_DIR="$PWD"
COMMIT_DIRS=""
NL='
'
SEGMENTS=$(printf '%s\n' "$COMMAND" | awk '{gsub(/&&|;/, "\n"); print}')

while IFS= read -r seg; do
  # `cd <path>` segment: update the tracked directory.
  if printf '%s' "$seg" | grep -qE '^[[:space:]]*cd[[:space:]]'; then
    dir=$(printf '%s' "$seg" | sed -E 's/^[[:space:]]*cd[[:space:]]+//; s/[[:space:]]+$//')
    dir=$(unquote "$dir")
    case "$dir" in
      /*) TRACKED_DIR="$dir" ;;
      "") : ;;
      *) TRACKED_DIR="$TRACKED_DIR/$dir" ;;
    esac
    continue
  fi

  if printf '%s' "$seg" | grep -qE "$GIT_COMMIT_RE"; then
    # `git -C <dir> commit` overrides the tracked cd for this invocation.
    c_dir=$(printf '%s' "$seg" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+)[[:space:]]+commit.*/\1/p')
    if [ -n "$c_dir" ]; then
      c_dir=$(unquote "$c_dir")
      case "$c_dir" in
        /*) COMMIT_DIRS="${COMMIT_DIRS}${c_dir}${NL}" ;;
        *) COMMIT_DIRS="${COMMIT_DIRS}${TRACKED_DIR}/${c_dir}${NL}" ;;
      esac
    else
      COMMIT_DIRS="${COMMIT_DIRS}${TRACKED_DIR}${NL}"
    fi
  fi
done <<EOF_SEGMENTS
$SEGMENTS
EOF_SEGMENTS

# No commit segment resolved (parsing edge case) — fall back to the hook cwd
# so a plain `git commit` is still checked.
if [ -z "$COMMIT_DIRS" ]; then
  COMMIT_DIRS="$PWD"
fi

while IFS= read -r commit_dir; do
  [ -z "$commit_dir" ] && continue
  CURRENT_BRANCH=$(git -C "$commit_dir" branch --show-current 2>/dev/null)
  if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    # Feedback must go to STDERR — the harness surfaces stderr on exit 2;
    # stdout is dropped ("No stderr output").
    {
      echo "BLOCKED: git commit on '$CURRENT_BRANCH' (in $commit_dir) is not allowed."
      echo "Create a feature branch first: git checkout -b feat/your-feature"
      echo "Direct commits to main bypass CI/CD, Sentry review, and code review."
    } >&2
    exit 2
  fi
done <<EOF_DIRS
$COMMIT_DIRS
EOF_DIRS

exit 0
