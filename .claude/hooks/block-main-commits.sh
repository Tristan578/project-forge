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
# and stash pop (restages work for a commit on the current branch). merge
# --no-commit and revert --no-commit/-n are exempt for the same reason as
# pull --ff-only: no commit is created.
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
# The leading boundary also admits shell separators so a `git` abutting one
# (`;git commit`, `(git commit)`) is still recognized (PF-995).
GIT_CMD='(^|[[:space:]]|[;&|()])(GIT_[A-Z_]+=('"$Q"')[[:space:]]+)*git([[:space:]]+'"$GIT_OPT"')*[[:space:]]+'

# Every git subcommand that creates commits (or, for stash pop, restages
# work for one on the current branch). The trailing boundary admits shell
# separators too, so a subcommand abutting one (`git commit;`, `git commit&&`,
# `git commit|cat`, `(git commit)`) is not missed by the prefilter (PF-995).
MUTATE_SUB='(commit|merge|cherry-pick|revert|pull|stash[[:space:]]+pop)([[:space:]]|[;&|()]|$)'
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

# Per-directory pending-branch-switch state, as two parallel bash 3.2
# indexed arrays (NOT associative arrays — those require bash 4+, and the
# system bash on macOS is 3.2.57). Two independent `-C <dirA>`/`-C <dirB>`
# segments in one compound command must track distinct pending branches
# instead of clobbering a single global scalar (PF-995 / #8988 round 2 fix 1).
pending_lookup() {
  local d="$1" i
  for i in "${!PENDING_DIRS[@]}"; do
    if [ "${PENDING_DIRS[$i]}" = "$d" ]; then
      printf '%s' "${PENDING_BRANCHES[$i]}"
      return 0
    fi
  done
  return 1
}

pending_set() {
  local d="$1" b="$2" i
  for i in "${!PENDING_DIRS[@]}"; do
    if [ "${PENDING_DIRS[$i]}" = "$d" ]; then
      PENDING_BRANCHES[$i]="$b"
      return 0
    fi
  done
  PENDING_DIRS+=("$d")
  PENDING_BRANCHES+=("$b")
}

pending_clear_all() {
  PENDING_DIRS=()
  PENDING_BRANCHES=()
}

# Which commit-creating subcommand appears in (classification) text, so the
# BLOCKED message can name it specifically (PF-995 / #8988 round 2 fix 4).
detect_subcmd() {
  local text="$1" sc
  for sc in commit merge cherry-pick revert pull; do
    if printf '%s' "$text" | grep -qE "${GIT_CMD}${sc}([[:space:]]|[;&|()]|$)"; then
      printf '%s' "$sc"
      return 0
    fi
  done
  if printf '%s' "$text" | grep -qE "${GIT_CMD}stash[[:space:]]+pop([[:space:]]|[;&|()]|$)"; then
    printf '%s' "stash pop"
    return 0
  fi
  return 1
}

# Walk the command's `&&`/`||`/`;`-chained segments in order, tracking `cd`
# so we know the working directory of each git invocation, and tracking
# branch switches so `git checkout -b tmp && git commit` is allowed while
# `git checkout -b tmp && git checkout main && git commit` is still blocked.
# Splitting can mis-fire on separators inside quoted strings (e.g. a commit
# message); a bogus tracked dir then fails the branch lookup below and the
# hook fails OPEN — same posture as the malformed-stdin path.
TRACKED_DIR="$PWD"
PENDING_DIRS=()      # per-directory pending-branch state (see helpers above)
PENDING_BRANCHES=()
FS=$'\x1f'           # field separator inside a COMMIT_TARGETS record
COMMIT_TARGETS=""    # newline-separated records: <kind>FS<subcmd>FS<value>
                     # kind: B=pending branch, G=git-dir, D=directory
HANDLED=0
NL='
'
SEGMENTS=$(printf '%s\n' "$COMMAND" | awk '{gsub(/&&|\|\||;/, "\n"); print}')

while IFS= read -r seg; do
  case "$seg" in *[![:space:]]*) ;; *) continue ;; esac

  # Classification-only copy with each single/double-quoted span collapsed to a
  # single placeholder token, so a quoted VALUE that happens to contain a git
  # subcommand or switch keyword (e.g. a commit message `-m "see git checkout
  # feature"` or `-m "git pull --ff-only"`) is never MISCLASSIFIED as a real
  # switch/mutation/exemption. A placeholder (not removal) preserves the token's
  # structural position, so a quoted OPTION VALUE like `--git-dir="path with
  # space"` or `-C "dir"` still parses as an option-with-value for the
  # classifiers. Only the yes/no classifiers below scan $seg_class; every
  # target- and directory-EXTRACTION still uses the original $seg — a genuine
  # keyword is unquoted there, and quoting is load-bearing for a branch/path
  # with spaces (PF-995 / #8988).
  seg_class=$(printf '%s' "$seg" | sed -E 's/"[^"]*"/X/g' | sed -E "s/'[^']*'/X/g")

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
    pending_clear_all
    continue
  fi

  # Branch switches earlier in the chain. Detection is opt-aware (GIT_CMD),
  # so the extraction must tolerate the same global-option chain too
  # (`git -C dir checkout -b X`, `git -c k=v switch Y`) — otherwise a
  # detected switch would extract no branch and fall through to a live
  # pre-execution lookup that still reports main.
  if printf '%s' "$seg_class" | grep -qE "${GIT_CMD}(checkout|switch)([[:space:]]|$)"; then
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
      pending_set "$sw_dir" "$(unquote "$nb")"
    elif printf '%s' "$seg" | grep -qE '[[:space:]]--([[:space:]]|$)'; then
      # Pathspec form (`git checkout main -- file`) — restores files, does
      # NOT change branch, so leave the pending state untouched. Deliberate
      # fail-open tradeoff: a pathspec-only checkout of a file whose name
      # happens to look like a branch would also be treated as "not a switch"
      # — acceptable under the accident threat model.
      :
    else
      # Plain `checkout|switch [opts] <target>`. Record the target — a switch
      # to a non-main/master ref is a legitimate feature branch, so a following
      # commit resolves to it instead of the pre-execution live branch (which
      # from a main checkout is still main → the false-block this fixes). A
      # switch to main/master records "main" and keeps the block.
      #
      # Skip any option tokens (`-q`, `--quiet`, …) that sit between the
      # keyword and the branch operand, then take the first operand. The bare
      # `-`/`--` (previous-branch shorthand / end-of-options) stops the scan
      # (PF-995 fix 4).
      rest=$(printf '%s' "$co" | sed -nE 's/^(checkout|switch)[[:space:]]+(.*)$/\2/p')
      while [ -n "$rest" ]; do
        first=$(printf '%s' "$rest" | sed -nE 's/^([^[:space:]]+).*/\1/p')
        case "$first" in
          -|--) break ;;
          -*) rest=$(printf '%s' "$rest" | sed -E 's/^[^[:space:]]+[[:space:]]*//') ;;
          *) break ;;
        esac
      done
      tgt=$(printf '%s' "$rest" | sed -nE 's/^("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+).*/\1/p')
      tgt=$(unquote "$tgt")
      if [ "$tgt" = "-" ]; then
        # `checkout -` / `switch -`: return to the previous branch. If an
        # earlier switch in THIS command already set the pending branch for the
        # same dir, that in-command switch is the branch we are leaving, so the
        # previous branch is that dir's live current branch; otherwise it is the
        # dir's real @{-1}. Fail CLOSED to main if neither resolves (PF-995 fix
        # 3) — an unresolved return could land back on main and must not slip.
        prevb=""
        if pending_lookup "$sw_dir" >/dev/null; then
          prevb=$(git -C "$sw_dir" branch --show-current 2>/dev/null)
        elif ! prevb=$(git -C "$sw_dir" rev-parse --abbrev-ref '@{-1}' 2>/dev/null); then
          prevb=""
        fi
        # A repo with no previous branch prints the literal '@{-1}' on stdout
        # while exiting non-zero; treat that (and an empty result) as
        # unresolved and fail CLOSED to main.
        case "$prevb" in ""|'@{-1}') prevb="main" ;; esac
        pending_set "$sw_dir" "$prevb"
      elif [ -n "$tgt" ]; then
        pending_set "$sw_dir" "$tgt"
      else
        # A genuine switch keyword was detected but no branch operand parsed
        # (e.g. options only). Any pending branch from an earlier switch is now
        # stale — clear it and fail CLOSED to main rather than leave the stale
        # value to falsely allow a following commit (PF-995 fix 4).
        pending_set "$sw_dir" "main"
      fi
    fi
    continue
  elif printf '%s' "$seg_class" | grep -qE "${GIT_CMD}branch([[:space:]]|$)"; then
    # `git branch -M <target>` / `-m <target>` renames the CURRENT branch —
    # no checkout/switch keyword involved, so it is invisible to the detector
    # above. Only the single-argument rename form is handled (PF-995 / #8988
    # round 2 fix 2); the two-argument `-M <old> <new>` form is out of scope.
    head_br=$(printf '%s' "$seg" | sed -E 's/[[:space:]]branch[[:space:]].*$//')
    br_cdir=$(printf '%s' "$head_br" | sed -nE 's/.*[[:space:]]-C[[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+).*/\1/p')
    br_dir=$(resolve_dir "$br_cdir")
    br_rest=$(printf '%s' "$seg" | sed -nE 's/^.*[[:space:]]branch[[:space:]]+(.*)$/\1/p')
    br_words=$(printf '%s' "$br_rest" | wc -w | tr -d '[:space:]')
    if printf '%s' "$br_rest" | grep -qE '^-[mM]([[:space:]]|$)' && [ "$br_words" -eq 2 ]; then
      br_tgt=$(printf '%s' "$br_rest" | sed -nE 's/^-[mM][[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+)[[:space:]]*$/\1/p')
      br_tgt=$(unquote "$br_tgt")
      case "$br_tgt" in
        main|master) pending_set "$br_dir" "$br_tgt" ;;
      esac
    fi
    continue
  fi

  # Only commit-creating segments from here on.
  if ! printf '%s' "$seg_class" | grep -qE "$GIT_MUTATE_RE"; then
    continue
  fi
  HANDLED=1
  subcmd=$(detect_subcmd "$seg_class")
  [ -z "$subcmd" ] && subcmd="commit"

  # `git pull --ff-only` cannot create commits. Both the pull detection and
  # the --ff-only check run on the quote-stripped copy so a quoted message
  # like `-m "git pull --ff-only"` cannot smuggle the exemption (PF-995).
  if printf '%s' "$seg_class" | grep -qE "${GIT_CMD}pull([[:space:]]|$)" \
     && printf '%s' "$seg_class" | grep -qE -- '--ff-only'; then
    continue
  fi

  # `git revert --no-commit`/`-n` and `git merge --no-commit` create NO
  # commit either — exactly analogous to `pull --ff-only` above. Both the
  # subcommand detection and the flag check run on the quote-stripped copy
  # so a quoted commit message cannot smuggle the exemption (PF-995 / #8988
  # round 2 fix 3).
  if printf '%s' "$seg_class" | grep -qE "${GIT_CMD}revert([[:space:]]|$)" \
     && printf '%s' "$seg_class" | grep -qE -- '(^|[[:space:]])(-n|--no-commit)([[:space:]]|$)'; then
    continue
  fi
  if printf '%s' "$seg_class" | grep -qE "${GIT_CMD}merge([[:space:]]|$)" \
     && printf '%s' "$seg_class" | grep -qE -- '(^|[[:space:]])--no-commit([[:space:]]|$)'; then
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
      /*) COMMIT_TARGETS="${COMMIT_TARGETS}G${FS}${subcmd}${FS}${g_dir}${NL}" ;;
      *) COMMIT_TARGETS="${COMMIT_TARGETS}G${FS}${subcmd}${FS}${TRACKED_DIR}/${g_dir}${NL}" ;;
    esac
    continue
  fi

  # GIT_WORK_TREE= / --work-tree point the commit at another checkout —
  # treat that checkout as the target (conservative).
  w_tree=$(printf '%s' "$head_part" | sed -nE 's/.*(GIT_WORK_TREE=|--work-tree[= ])("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+).*/\2/p')
  if [ -n "$w_tree" ]; then
    w_tree=$(unquote "$w_tree")
    case "$w_tree" in
      /*) COMMIT_TARGETS="${COMMIT_TARGETS}D${FS}${subcmd}${FS}${w_tree}${NL}" ;;
      *) COMMIT_TARGETS="${COMMIT_TARGETS}D${FS}${subcmd}${FS}${TRACKED_DIR}/${w_tree}${NL}" ;;
    esac
    continue
  fi

  # `git -C <dir>` overrides the tracked cd for this invocation; otherwise
  # the commit lands in the tracked cwd. A statically-known branch switch for
  # the SAME effective directory wins over a pre-execution live lookup (the
  # `git -C dir checkout -b X && git -C dir commit` case).
  c_dir=$(printf '%s' "$head_part" | sed -nE 's/.*[[:space:]]-C[[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+).*/\1/p')
  effdir=$(resolve_dir "$c_dir")
  if pb=$(pending_lookup "$effdir"); then
    COMMIT_TARGETS="${COMMIT_TARGETS}B${FS}${subcmd}${FS}${pb}${NL}"
  else
    COMMIT_TARGETS="${COMMIT_TARGETS}D${FS}${subcmd}${FS}${effdir}${NL}"
  fi
done <<EOF_SEGMENTS
$SEGMENTS
EOF_SEGMENTS

# The whole-command filter matched but no segment resolved (quoting edge
# case) — fall back to the hook cwd so a plain commit is still checked. The
# HANDLED guard keeps an exempted `pull --ff-only` from re-entering here.
if [ -z "$COMMIT_TARGETS" ] && [ "$HANDLED" -eq 0 ]; then
  fb_subcmd=$(detect_subcmd "$COMMAND")
  [ -z "$fb_subcmd" ] && fb_subcmd="commit"
  COMMIT_TARGETS="D${FS}${fb_subcmd}${FS}${PWD}"
fi

while IFS="$FS" read -r kind subcmd val; do
  [ -z "$kind" ] && continue
  case "$kind" in
    B) CURRENT_BRANCH="$val"; CONTEXT="pending branch '${val}'" ;;
    G) CURRENT_BRANCH=$(git --git-dir="$val" branch --show-current 2>/dev/null); CONTEXT="git-dir '${val}'" ;;
    D) CURRENT_BRANCH=$(git -C "$val" branch --show-current 2>/dev/null); CONTEXT="directory '${val}'" ;;
    *) CURRENT_BRANCH=""; CONTEXT="" ;;
  esac
  if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    # Feedback must go to STDERR — the harness surfaces stderr on exit 2;
    # stdout is dropped ("No stderr output"). Name the resolving context so
    # multi-segment chains are debuggable, and name the specific subcommand
    # that triggered the block (PF-995 / #8988 round 2 fix 4).
    {
      echo "BLOCKED: 'git ${subcmd}' on '$CURRENT_BRANCH' is not allowed."
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
