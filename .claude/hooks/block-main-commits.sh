#!/bin/bash
# PreToolUse hook for Bash: block commit-creating git operations on
# main/master. Agents (especially worktree agents) must use feature branches.
# Direct commits to main bypass CI/CD and Sentry review.
#
# The branch check must run against the repo each git invocation actually
# targets. Hooks execute with the SESSION's cwd — often the main checkout,
# parked on main — while agents commit inside `cd <worktree> && git commit`
# compound commands, via `git -C <dir> commit`, or via GIT_DIR/--git-dir/
# --work-tree redirection. Checking the hook's own cwd would block every
# worktree commit whenever the main checkout sits on main.
#
# Blocked subcommands: commit, merge, cherry-pick, revert, pull (unless
# --ff-only, which cannot create commits — the sanctioned way to sync main),
# and stash pop (restages work for a commit on the current branch).
#
# Contract: exit 0 = allow, exit 2 = block (stderr carries the reason).
# Fail-open posture: if the effective target can't be resolved (subshells,
# variables, interpolation), the hook allows — PR review is the backstop.
# This is an ACCIDENT gate, not an adversarial one.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# A single (possibly quoted) argument token.
Q='"[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+'

# Global git options that may sit between `git` and its subcommand:
# -C <dir>, -c <key=val>, value-taking long options in their SPACE-separated
# form (`--git-dir <path>`, not just `--git-dir=<path>`), --long-flag[=value],
# and single-letter flags. The value-taking long options are enumerated
# explicitly (git's global set is small and fixed) rather than matched as a
# generic `--opt <value>` — a generic form would greedily swallow the
# subcommand token as if it were the option's value and defeat detection.
GIT_VALOPT='--(git-dir|work-tree|namespace|super-prefix|config-env|attr-source)[[:space:]]+('"$Q"')'
GIT_OPT='(-C[[:space:]]+('"$Q"')|-c[[:space:]]+('"$Q"')|'"$GIT_VALOPT"'|--[[:alnum:]-]+(=('"$Q"'))?|-[[:alnum:]])'

# `git` at a word boundary (so text like "legit commit" does not match),
# optionally preceded by GIT_* env assignments, followed by global options.
GIT_CMD='(^|[[:space:]])(GIT_[A-Z_]+=('"$Q"')[[:space:]]+)*git([[:space:]]+'"$GIT_OPT"')*[[:space:]]+'

# Every git subcommand that creates commits (or, for stash pop, restages
# work for one on the current branch).
MUTATE_SUB='(commit|merge|cherry-pick|revert|pull|stash[[:space:]]+pop)([[:space:]]|$)'
GIT_MUTATE_RE="${GIT_CMD}${MUTATE_SUB}"

if ! printf '%s' "$COMMAND" | grep -qE "$GIT_MUTATE_RE"; then
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

# Resolve a (possibly quoted, possibly relative, possibly empty) directory
# token against the currently tracked cwd, yielding an absolute-ish path.
resolve_dir() {
  local d
  d=$(unquote "$1")
  case "$d" in
    /*) printf '%s' "$d" ;;
    "") printf '%s' "$TRACKED_DIR" ;;
    *) printf '%s' "$TRACKED_DIR/$d" ;;
  esac
}

# Walk the command's `&&`/`||`/`;`-chained segments in order, tracking `cd`
# so we know the working directory of each git invocation, and tracking
# branch switches so `git checkout -b tmp && git commit` is allowed while
# `git checkout -b tmp && git checkout main && git commit` is still blocked.
# Splitting can mis-fire on separators inside quoted strings (e.g. a commit
# message); a bogus tracked dir then fails the branch lookup below and the
# hook fails OPEN — same posture as the malformed-stdin path.
TRACKED_DIR="$PWD"
PENDING_BRANCH=""   # non-empty → statically-known branch for PENDING_DIR
PENDING_DIR=""      # directory the pending branch switch applies to
COMMIT_TARGETS=""   # newline-separated: B:<branch> | G:<git-dir> | D:<dir>
HANDLED=0
NL='
'
SEGMENTS=$(printf '%s\n' "$COMMAND" | awk '{gsub(/&&|\|\||;/, "\n"); print}')

while IFS= read -r seg; do
  case "$seg" in *[![:space:]]*) ;; *) continue ;; esac

  # `cd <path>` segment: update the tracked directory. A branch switch in
  # one directory says nothing about another, so reset that state too.
  if printf '%s' "$seg" | grep -qE '^[[:space:]]*cd[[:space:]]'; then
    dir=$(printf '%s' "$seg" | sed -E 's/^[[:space:]]*cd[[:space:]]+//; s/[[:space:]]+$//')
    dir=$(unquote "$dir")
    case "$dir" in
      /*) TRACKED_DIR="$dir" ;;
      "") : ;;
      *) TRACKED_DIR="$TRACKED_DIR/$dir" ;;
    esac
    PENDING_BRANCH=""
    PENDING_DIR=""
    continue
  fi

  # Branch switches earlier in the chain. Detection is opt-aware (GIT_CMD),
  # so the extraction must tolerate the same global-option chain too
  # (`git -C dir checkout -b X`, `git -c k=v switch Y`) — otherwise a
  # detected switch would extract no branch and fall through to a live
  # pre-execution lookup that still reports main.
  if printf '%s' "$seg" | grep -qE "${GIT_CMD}(checkout|switch)([[:space:]]|$)"; then
    # Effective directory of the switch: `git -C <dir>` overrides the cwd.
    head_co=$(printf '%s' "$seg" | sed -E 's/[[:space:]](checkout|switch)[[:space:]].*$//')
    co_cdir=$(printf '%s' "$head_co" | sed -nE 's/.*[[:space:]]-C[[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+).*/\1/p')
    sw_dir=$(resolve_dir "$co_cdir")
    # Isolate "<sub> <args>" from the switch keyword onward, dropping the
    # opt chain so the branch extraction below is a simple anchored match.
    co=$(printf '%s' "$seg" | sed -nE 's/.*[[:space:]](checkout|switch)[[:space:]]+(.*)$/\1 \2/p')
    # Force-create/reset forms name a brand-new branch: checkout -b / -B and
    # switch -c / -C all set the pending branch identically.
    nb=$(printf '%s' "$co" | sed -nE 's/^(checkout[[:space:]]+-[bB]|switch[[:space:]]+-[cC])[[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+).*/\2/p')
    if [ -n "$nb" ]; then
      PENDING_BRANCH=$(unquote "$nb")
      PENDING_DIR="$sw_dir"
    elif printf '%s' "$seg" | grep -qE '[[:space:]]--([[:space:]]|$)'; then
      # Pathspec form (`git checkout main -- file`) — restores files, does
      # NOT change branch, so leave the pending state untouched. Deliberate
      # fail-open tradeoff: a pathspec-only checkout of a file whose name
      # happens to look like a branch would also be treated as "not a switch"
      # — acceptable under the accident threat model.
      :
    else
      # Plain `checkout|switch <target>`. Record the target — a switch to a
      # non-main/master ref is a legitimate feature branch, so a following
      # commit resolves to it instead of the pre-execution live branch (which
      # from a main checkout is still main → the false-block this fixes). A
      # switch to main/master records "main" and keeps the block.
      tgt=$(printf '%s' "$co" | sed -nE 's/^(checkout|switch)[[:space:]]+([^-][^[:space:]]*).*/\2/p')
      tgt=$(unquote "$tgt")
      if [ -n "$tgt" ]; then
        PENDING_BRANCH="$tgt"
        PENDING_DIR="$sw_dir"
      fi
    fi
    continue
  fi

  # Only commit-creating segments from here on.
  if ! printf '%s' "$seg" | grep -qE "$GIT_MUTATE_RE"; then
    continue
  fi
  HANDLED=1

  # `git pull --ff-only` cannot create commits.
  if printf '%s' "$seg" | grep -qE "${GIT_CMD}pull([[:space:]]|$)" \
     && printf '%s' "$seg" | grep -qE -- '--ff-only'; then
    continue
  fi

  # Options after the subcommand belong to the subcommand (`git commit -C
  # <commit>` reuses a message, it does not change directory) — resolve
  # repo redirection only from the text BEFORE the subcommand.
  head_part=$(printf '%s' "$seg" | sed -E 's/[[:space:]](commit|merge|cherry-pick|revert|pull|stash[[:space:]]+pop)([[:space:]].*)?$//')

  # GIT_DIR= / --git-dir redirect the repository regardless of cwd.
  g_dir=$(printf '%s' "$head_part" | sed -nE 's/.*(GIT_DIR=|--git-dir[= ])("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+).*/\2/p')
  if [ -n "$g_dir" ]; then
    g_dir=$(unquote "$g_dir")
    case "$g_dir" in
      /*) COMMIT_TARGETS="${COMMIT_TARGETS}G:${g_dir}${NL}" ;;
      *) COMMIT_TARGETS="${COMMIT_TARGETS}G:${TRACKED_DIR}/${g_dir}${NL}" ;;
    esac
    continue
  fi

  # GIT_WORK_TREE= / --work-tree point the commit at another checkout —
  # treat that checkout as the target (conservative).
  w_tree=$(printf '%s' "$head_part" | sed -nE 's/.*(GIT_WORK_TREE=|--work-tree[= ])("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+).*/\2/p')
  if [ -n "$w_tree" ]; then
    w_tree=$(unquote "$w_tree")
    case "$w_tree" in
      /*) COMMIT_TARGETS="${COMMIT_TARGETS}D:${w_tree}${NL}" ;;
      *) COMMIT_TARGETS="${COMMIT_TARGETS}D:${TRACKED_DIR}/${w_tree}${NL}" ;;
    esac
    continue
  fi

  # `git -C <dir>` overrides the tracked cd for this invocation; otherwise
  # the commit lands in the tracked cwd. A statically-known branch switch for
  # the SAME effective directory wins over a pre-execution live lookup (the
  # `git -C dir checkout -b X && git -C dir commit` case).
  c_dir=$(printf '%s' "$head_part" | sed -nE 's/.*[[:space:]]-C[[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+).*/\1/p')
  effdir=$(resolve_dir "$c_dir")
  if [ -n "$PENDING_BRANCH" ] && [ "$PENDING_DIR" = "$effdir" ]; then
    COMMIT_TARGETS="${COMMIT_TARGETS}B:${PENDING_BRANCH}${NL}"
  else
    COMMIT_TARGETS="${COMMIT_TARGETS}D:${effdir}${NL}"
  fi
done <<EOF_SEGMENTS
$SEGMENTS
EOF_SEGMENTS

# The whole-command filter matched but no segment resolved (quoting edge
# case) — fall back to the hook cwd so a plain commit is still checked. The
# HANDLED guard keeps an exempted `pull --ff-only` from re-entering here.
if [ -z "$COMMIT_TARGETS" ] && [ "$HANDLED" -eq 0 ]; then
  COMMIT_TARGETS="D:$PWD"
fi

while IFS= read -r target; do
  [ -z "$target" ] && continue
  case "$target" in
    B:*) CURRENT_BRANCH="${target#B:}"; CONTEXT="pending branch '${CURRENT_BRANCH}'" ;;
    G:*) CURRENT_BRANCH=$(git --git-dir="${target#G:}" branch --show-current 2>/dev/null); CONTEXT="git-dir '${target#G:}'" ;;
    D:*) CURRENT_BRANCH=$(git -C "${target#D:}" branch --show-current 2>/dev/null); CONTEXT="directory '${target#D:}'" ;;
    *) CURRENT_BRANCH=""; CONTEXT="" ;;
  esac
  if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    # Feedback must go to STDERR — the harness surfaces stderr on exit 2;
    # stdout is dropped ("No stderr output"). Name the resolving context so
    # multi-segment chains are debuggable.
    {
      echo "BLOCKED: commit-creating git operation on '$CURRENT_BRANCH' is not allowed."
      echo "Resolved from ${CONTEXT}."
      echo "Create a feature branch first: git checkout -b feat/your-feature"
      echo "To sync main from origin, use: git pull --ff-only"
      echo "Direct commits to main bypass CI/CD, Sentry review, and code review."
    } >&2
    exit 2
  fi
done <<EOF_DIRS
$COMMIT_TARGETS
EOF_DIRS

exit 0
