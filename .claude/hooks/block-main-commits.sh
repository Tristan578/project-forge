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
# The leading boundary also admits shell separators AND the quote/backtick
# characters, so a `git` abutting one (`;git commit`, `(git commit)`, and a
# nested-interpreter payload whose text begins with git — `bash -c "git commit"`,
# `bash -c 'git commit'`, `` `git commit` ``) is still recognized (PF-995).
GIT_CMD='(^|[[:space:]]|[;&|()"`'\''])(GIT_[A-Z_]+=('"$Q"')[[:space:]]+)*git([[:space:]]+'"$GIT_OPT"')*[[:space:]]+'

# Trailing boundary after a mutate subcommand. Mirrors the GIT_CMD leading
# class (above): besides whitespace / shell separators / end-of-string, it
# admits the quote and backtick characters, so a subcommand abutting a CLOSING
# quote or backtick in its BARE form (no trailing args) is not missed —
# `bash -c "git commit"`, `bash -c 'git commit'`, `` `git commit` ``,
# `eval "git merge"` (PF-995). Factored into ONE variable used at all three
# trailing-class sites (here + detect_subcmd's two greps) so they cannot drift.
# Same bash-3.2-safe bracket quoting as line 50: single-quoted `'\''` for the
# embedded single quote, backtick literal inside single quotes.
SUB_END='([[:space:]]|[;&|()"`'\'']|$)'

# Every git subcommand that creates commits (or, for stash pop, restages
# work for one on the current branch), abutting the trailing boundary above.
MUTATE_SUB='(commit|merge|cherry-pick|revert|pull|stash[[:space:]]+pop)'"$SUB_END"
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
      PENDING_BRANCHES[i]="$b"
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
    if printf '%s' "$text" | grep -qE "${GIT_CMD}${sc}${SUB_END}"; then
      printf '%s' "$sc"
      return 0
    fi
  done
  if printf '%s' "$text" | grep -qE "${GIT_CMD}stash[[:space:]]+pop${SUB_END}"; then
    printf '%s' "stash pop"
    return 0
  fi
  return 1
}

# Split a command string into its shell command segments, one per line, each
# line PREFIXED with a single link-code char and $FS: `A` = this segment is
# linked to its predecessor by a guaranteed-success `&&` chain (so a recorded
# branch switch/rename earlier in the chain is TRUSTED to have taken effect
# before this segment runs); `O` = linked by any OTHER separator (`;`, `||`,
# `|`, `&`, a literal newline) — or it is the first segment. Only `&&`
# short-circuits on the predecessor's success, so only `A` may carry pending
# switch/rename trust forward; every `O` link RESETS that trust in the loop
# below, so a following commit falls through to the live $PWD lookup (PF-995 /
# #8988 round 4 finding 1 — the round-3 splitter collapsed EVERY separator to a
# bare newline, erasing this distinction and letting `git checkout feat/x ;
# git commit` launder a commit onto main).
#
# Separators recognized OUTSIDE single/double quotes: `&&`, `||`, `;`, a
# single `&` (background), a single `|` (pipe), and a literal newline. A
# separator INSIDE a quoted span is inert data, never a split point — so a
# quoted VALUE that merely contains `git commit` (e.g. a jq `--arg` payload)
# can never form a pseudo command segment (PF-995 / #8988 round 3 fixes 1/2).
#
# Bash 3.2 char scanner (the system bash on macOS is 3.2.57 — NO associative
# arrays, NO mapfile). The quoting model matches $seg_class's below (a bare
# `"`/`'` toggles the span; backslash escapes are NOT interpreted, exactly as
# the sed collapse does not), so the splitter and the classifier always agree
# on what is "inside quotes". A literal newline inside a quoted span is emitted
# as a space so a single quoted value never straddles two `read` iterations;
# unbalanced quoting simply runs to end-of-string (fail-open — the resulting
# segment fails the branch lookup below and the hook allows).
split_segments() {
  # NOTE: `n=${#s}` MUST be a separate `local` from `s="$1"` — bash 3.2 expands
  # every RHS on a single `local` line against the PRE-command environment, so
  # `local s="$1" n=${#s}` would read the OLD (unset) s and set n=0, making the
  # loop below never run and every command fall through to the PWD fallback.
  local s="$1"
  local n=${#s} i=0 c nc inq=0 out=""
  out="A$FS"                                   # first segment: no predecessor
  while [ "$i" -lt "$n" ]; do
    c=${s:i:1}
    if [ "$inq" -eq 1 ]; then                 # inside single quotes
      [ "$c" = "'" ] && inq=0
      if [ "$c" = "$NL" ]; then out="$out "; else out="$out$c"; fi
      i=$((i + 1)); continue
    fi
    if [ "$inq" -eq 2 ]; then                 # inside double quotes
      [ "$c" = '"' ] && inq=0
      if [ "$c" = "$NL" ]; then out="$out "; else out="$out$c"; fi
      i=$((i + 1)); continue
    fi
    case "$c" in
      "'") inq=1; out="$out$c"; i=$((i + 1)); continue ;;
      '"') inq=2; out="$out$c"; i=$((i + 1)); continue ;;
    esac
    nc=${s:i+1:1}
    if [ "$c" = "&" ] && [ "$nc" = "&" ]; then
      out="$out${NL}A$FS"; i=$((i + 2)); continue    # `&&` — trusted link
    fi
    if [ "$c" = "|" ] && [ "$nc" = "|" ]; then
      out="$out${NL}O$FS"; i=$((i + 2)); continue    # `||` — untrusted link
    fi
    case "$c" in
      "&"|"|"|";"|"$NL") out="$out${NL}O$FS"; i=$((i + 1)); continue ;;   # single &, |, ;, newline
    esac
    out="$out$c"; i=$((i + 1))
  done
  printf '%s' "$out"
}

# Walk the command's segments (see split_segments) in order, tracking `cd` so
# we know the working directory of each git invocation, and tracking branch
# switches so `git checkout -b tmp && git commit` is allowed while
# `git checkout -b tmp && git checkout main && git commit` is still blocked.
# A segment whose quoting is unbalanced yields a bogus tracked dir that fails
# the branch lookup below and the hook fails OPEN — same posture as the
# malformed-stdin path.
TRACKED_DIR="$PWD"
PENDING_DIRS=()      # per-directory pending-branch state (see helpers above)
PENDING_BRANCHES=()
FS=$'\x1f'           # field separator inside a COMMIT_TARGETS record
COMMIT_TARGETS=""    # newline-separated records: <kind>FS<subcmd>FS<value>
                     # kind: B=pending branch, G=git-dir, D=directory
HANDLED=0
# Set when a commit-creating subcommand shares a segment with a switch/branch
# keyword (so the switch/branch short-circuit skips it and it is never recorded
# as a target). It forces the $PWD fallback below to fire even when an EARLIER
# benign target was recorded, so an unattributed commit cannot slip (PF-995 /
# #8988 round 3 fix 3).
UNATTRIBUTED=0
NL='
'
SEGMENTS=$(split_segments "$COMMAND")

# Each SEGMENTS line is `<sepcode>$FS<segment text>` (see split_segments):
# `A` = linked to its predecessor by a guaranteed-success `&&` chain, `O` = any
# other link (`;`, `||`, `|`, `&`, newline) or the first segment. On every `O`
# link we DROP the pending branch-switch/rename trust recorded by earlier
# segments, because only `&&` guarantees the switch actually succeeded before
# this segment runs — so `git checkout feat/x ; git commit` (semicolon), `... ||
# git commit`, `... | git commit`, `... & git commit` all fall through to the
# live $PWD branch lookup (block on main) instead of trusting a switch that may
# never have taken effect (PF-995 / #8988 round 4 finding 1). TRACKED_DIR (from
# `cd`) is intentionally NOT reset — that is orthogonal to switch trust.
while IFS="$FS" read -r sepcode seg; do
  if [ "$sepcode" != "A" ]; then pending_clear_all; fi
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
    # A commit-creating subcommand riding in the SAME segment as this switch
    # (e.g. hidden in a `$(...)`/backtick the splitter can't see) is never
    # recorded as a target because of the `continue` below — flag it so the
    # $PWD fallback still checks it (PF-995 / #8988 round 3 fix 3).
    if printf '%s' "$seg_class" | grep -qE "$GIT_MUTATE_RE"; then UNATTRIBUTED=1; fi
    continue
  elif printf '%s' "$seg_class" | grep -qE "${GIT_CMD}branch([[:space:]]|$)"; then
    # `git branch -M <new>` / `-m <new>` renames the CURRENT branch, and the
    # two-argument `git branch -M <old> <new>` / `-m <old> <new>` renames the
    # named branch to <new> — no checkout/switch keyword is involved either
    # way, so both are invisible to the detector above. When the resulting
    # branch name is main/master AND the rename targets the segment's current
    # branch, set the same pending-rename state a switch-to-main would (PF-995
    # / #8988 round 2 fix 2 + round 3 fix 4).
    head_br=$(printf '%s' "$seg" | sed -E 's/[[:space:]]branch[[:space:]].*$//')
    br_cdir=$(printf '%s' "$head_br" | sed -nE 's/.*[[:space:]]-C[[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+).*/\1/p')
    br_dir=$(resolve_dir "$br_cdir")
    br_rest=$(printf '%s' "$seg" | sed -nE 's/^.*[[:space:]]branch[[:space:]]+(.*)$/\1/p')
    br_words=$(printf '%s' "$br_rest" | wc -w | tr -d '[:space:]')
    if printf '%s' "$br_rest" | grep -qE '^-[mM]([[:space:]]|$)'; then
      if [ "$br_words" -eq 2 ]; then
        # One-arg rename: `-M <new>` renames whatever branch is current.
        br_new=$(printf '%s' "$br_rest" | sed -nE 's/^-[mM][[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+)[[:space:]]*$/\1/p')
        br_new=$(unquote "$br_new")
        case "$br_new" in
          main|master) pending_set "$br_dir" "$br_new" ;;
        esac
      elif [ "$br_words" -eq 3 ]; then
        # Two-arg rename: `-M <old> <new>`. Only pends when <new> is main/master
        # AND <old> is the effective directory's current branch — renaming some
        # OTHER branch to main does not move HEAD, so a following commit is not
        # on main. If the current branch can't be resolved (bad dir / not a
        # repo), fail CLOSED and treat it as renaming the current branch.
        br_old=$(printf '%s' "$br_rest" | sed -nE 's/^-[mM][[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+)[[:space:]]+.*$/\1/p')
        br_old=$(unquote "$br_old")
        br_new=$(printf '%s' "$br_rest" | sed -nE 's/^-[mM][[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+)[[:space:]]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+)[[:space:]]*$/\2/p')
        br_new=$(unquote "$br_new")
        case "$br_new" in
          main|master)
            br_cur=$(git -C "$br_dir" branch --show-current 2>/dev/null)
            if [ -z "$br_cur" ] || [ "$br_cur" = "$br_old" ]; then
              pending_set "$br_dir" "$br_new"
            fi
            ;;
        esac
      fi
    fi
    # Same guard as the switch branch: a commit hidden in this branch-rename
    # segment (via `$(...)`/backtick) is skipped by the `continue`, so flag it
    # for the $PWD fallback (PF-995 / #8988 round 3 fix 3).
    if printf '%s' "$seg_class" | grep -qE "$GIT_MUTATE_RE"; then UNATTRIBUTED=1; fi
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

# The whole-command prefilter (top of file) is NOT quote-aware, so a benign
# command whose ONLY "git commit" text sits inside a quoted string (an `echo`
# reminder, a `jq --arg` payload) passes it, yet no segment's quote-stripped
# class resolves a real git target. Blocking such a command on $PWD is a false
# BLOCK (PF-995 / #8988 round 4 finding 3). To tell it apart from a quoted
# payload handed to a NESTED shell — `bash -c 'git commit'`, `eval 'git commit'`,
# where the quoted text really will execute — compute a quote-collapsed skeleton
# and look for an interpreter-with-inline-code (`bash|sh|zsh|ksh|dash … -c`) or
# `eval`. Present → keep the fail-CLOSED $PWD fallback; absent → allow.
COMMAND_CLASS=$(printf '%s' "$COMMAND" | sed -E 's/"[^"]*"/X/g' | sed -E "s/'[^']*'/X/g")
NESTED_INTERP=0
# `-[[:alnum:]]*c` matches a `-c` flag possibly bundled with other letters
# (`-xc`); the `([^[:space:]]+[[:space:]]+)*` hop skips any intervening options
# (`bash -euo pipefail -c …`) between the interpreter name and its `-c`.
INTERP_RE='(^|[[:space:]]|[;&|()])(bash|sh|zsh|ksh|dash)[[:space:]]+([^[:space:]]+[[:space:]]+)*-[[:alnum:]]*c([[:space:]]|$)'
EVAL_RE='(^|[[:space:]]|[;&|()])eval([[:space:]]|$)'
if printf '%s' "$COMMAND_CLASS" | grep -qE "$INTERP_RE" \
   || printf '%s' "$COMMAND_CLASS" | grep -qE "$EVAL_RE"; then
  NESTED_INTERP=1
fi

# Fall back to the hook cwd so a plain commit is still checked. Two triggers:
#   1. The whole-command filter matched but NO segment resolved a target — a
#      quoting edge case. This now fires ONLY when a nested interpreter is
#      present (see above): a benign quoted "git commit" mention is allowed,
#      but a quoted payload fed to `bash -c`/`eval` stays blocked (fail closed).
#      The HANDLED guard keeps an exempted `pull --ff-only` from re-entering here.
#   2. A commit rode inside a switch/branch segment and was never attributed
#      ($UNATTRIBUTED). This fires even when an EARLIER benign target WAS
#      recorded — a non-main target from one segment must not suppress the
#      fallback for a later unattributed commit — so the record is APPENDED,
#      not assigned (PF-995 / #8988 round 3 fix 3).
if { [ -z "$COMMIT_TARGETS" ] && [ "$HANDLED" -eq 0 ] && [ "$NESTED_INTERP" -eq 1 ]; } || [ "$UNATTRIBUTED" -eq 1 ]; then
  fb_subcmd=$(detect_subcmd "$COMMAND")
  [ -z "$fb_subcmd" ] && fb_subcmd="commit"
  COMMIT_TARGETS="${COMMIT_TARGETS}D${FS}${fb_subcmd}${FS}${PWD}${NL}"
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
