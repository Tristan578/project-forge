#!/usr/bin/env bash
# PreToolUse hook (Bash, and the GitHub MCP tools): refuse to call a PR ready
# unless GitHub says it is.
#
# WHY (#10328): on 2026-10-03 an agent moved PRs out of draft and posted board
# PASS verdicts while four Devin/Sentry review threads on #10305 and one on
# #10304 had sat unanswered for eight hours. The readiness audit that would have
# caught them (scripts/audit-pr-readiness.ps1) needs pwsh and GraphQL, and a
# Claude Code cloud session has neither, so the agent fell back to ad-hoc
# checks that never read review threads. A rule the agent must remember to run
# failed; this hook runs on the action itself.
#
# WHAT IT IS: a guardrail for an agent that is trying to follow the rules, not
# a boundary against one that is trying to get around them. It reads a shell
# command, and no reader of shell text covers every way to spell a call
# (lessons-learned #21). It covers the spellings below. Known gaps: a script a
# shell reads from a FILE (`bash ready.sh`, `bash < x`, `cat x | bash`) is not
# read; a script fed to a shell on stdin (heredoc, pipe) blocks only when the
# command text itself names a ready call; a body file is read only when cat,
# a < redirect or a body option feeds it; a gh call that hangs is bounded by
# `timeout` where the system has it (GNU coreutils), else only between calls
# (#10330).
#
# FIRES ON a Bash command that marks a PR ready or publishes a PASS for it:
#   - gh pr ready <n|url> [-R|--repo o/r] (not --undo, which moves to draft)
#   - gh api ... repos/<o>/<r>/pulls/<n>/ccr/ready_for_review
#   - gh api graphql with markPullRequestReadyForReview (no PR number can be
#     read from it, so it always blocks: use one of the forms above)
#   - [bash] post-board-verdict.sh <n> PASS
#   - a `board-verdict: PASS` marker posted as a comment: gh pr|issue comment
#     (--body/-b, --body-file/-F), or gh api with -f/-F/--field/--raw-field
#     body=... (body=@file is read) or --input <file>, on .../issues/<n>/comments
#     (a body built from $(...), a variable or stdin is searched across the
#     whole command AND each file it feeds as a body: an argument of cat, a
#     < redirect target, the value of -F/--body-file/--input, a key=@file)
# and on the GitHub MCP tools (matcher in .claude/settings.json):
#   - update_pull_request with draft: false (marks the PR ready)
#   - add_issue_comment / update_issue_comment whose body carries the marker
# The command is split into statements the way the shell splits it: ; & | and
# newlines OUTSIDE quotes, with $(...) and `...` as statements of their own and
# the script given to bash/sh/zsh -c, a here-string (<<<) or eval read again.
# Only a call in COMMAND POSITION counts (after VAR=value assignments and the
# wrappers sudo, env, command, exec, time, nohup, nice, ionice, stdbuf, timeout
# and xargs, by name or absolute path, each option's value skipped), so a
# commit message or echo that mentions `gh pr ready` is not a call.
# The repository is the one the call names (-R/--repo, a URL, the route's
# repos/<o>/<r>, a GH_REPO= prefix), else $GH_REPO, else the origin remote.
# A PR named by a variable, or not named at all, cannot be checked and blocks.
#
# For each PR named it reads the CURRENT head from GitHub and BLOCKS unless:
#   1. every review thread is resolved — `GET pulls/<n>/ccr/review_threads`
#      (the cloud proxy's REST route), else the GraphQL `reviewThreads` query
#      (a local session, where gh can reach GraphQL);
#   2. no check run on the head failed, timed out, was cancelled, failed to
#      start or needs action, and none is still queued or running — each
#      check judged by its latest run (a re-run replaces a failed attempt);
#   2b. no legacy commit status on the head (Vercel, review-board, ...) is in
#      `failure` or `error`, and none but `review-board` is `pending`:
#      review-board reads pending until the very PASS this hook guards is
#      posted, and the board protocol governs it; any other pending status is
#      a check that has not finished;
#   3. GitHub reports no merge conflict (`mergeable_state` is not `dirty`,
#      and not `unknown` — still computing; retry in a few seconds).
# FAIL-CLOSED: a fact that cannot be read blocks, and the message says which.
# TIME-BOUNDED: Claude Code lets a command through when its hook times out, so
# the hook stops itself first: past REQUIRE_PR_READY_BUDGET_SECONDS (default 25,
# under the 30 s timeout in .claude/settings.json) it BLOCKS instead of asking
# GitHub again, and each gh call is cut off at the time left.
#
# Exit 0 = allow, 2 = block (reason on stderr).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091  # dynamic $SCRIPT_DIR path; hook-utils.sh is linted on its own by the whole-tree glob
if ! source "$SCRIPT_DIR/hook-utils.sh"; then
  echo "BLOCKED: require-pr-ready could not load hook-utils.sh, so it cannot check readiness" >&2
  exit 2
fi

# Read stdin once, in this shell (a $(...) would cache it in a subshell).
hook_read_input >/dev/null
TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$_HOOK_INPUT" 2>/dev/null)
COMMAND=""
case "$TOOL_NAME" in
  mcp__*) ;;
  *)
    COMMAND=$(jq -r '.tool_input.command // empty' <<<"$_HOOK_INPUT" 2>/dev/null)
    [ -n "$COMMAND" ] || COMMAND=${TOOL_INPUT_command:-}
    [ -n "$COMMAND" ] || exit 0
    # Cheap exit for the common case: none of the trigger words appear at all.
    grep -qE 'gh|post-board-verdict' <<<"$COMMAND" || exit 0
    ;;
esac

BUDGET=${REQUIRE_PR_READY_BUDGET_SECONDS:-25}
[[ "$BUDGET" =~ ^[0-9]+$ ]] || BUDGET=25
DEADLINE=$((SECONDS + BUDGET))

FIX_ADVICE="Answer and resolve each review thread, fix or re-run a failed check, merge the base on a conflict, then retry."
block() { # <reason> [advice]
  echo "BLOCKED (require-pr-ready): $1" >&2
  [ -z "${MATCHED:-}" ] || echo "Matched: ${MATCHED:0:160}" >&2
  echo "${2:-$FIX_ADVICE}" >&2
  echo "A PR is ready only when every review thread is resolved, every check on its head passed, and it has no merge conflict." >&2
  exit 2
}

# budget_check: block before the harness's own timeout would let the call through.
budget_check() {
  [ "$SECONDS" -lt "$DEADLINE" ] \
    || block "ran out of time (${BUDGET}s) before GitHub answered, so readiness was not checked" "Retry; if it persists, check the PR on GitHub by hand."
}
# ghc: gh, cut off at the time left in the budget where `timeout` exists.
ghc() {
  local left=$((DEADLINE - SECONDS))
  [ "$left" -gt 0 ] || return 124
  if command -v timeout >/dev/null 2>&1; then timeout "$left" gh "$@"; else gh "$@"; fi
}
# fail <reason> [advice]: a GitHub read failed; say so, unless time ran out.
fail() { budget_check; block "$@"; }

# The origin remote's owner/repo (a github.com URL or a proxy URL ending in
# /owner/repo). Used only for a call that names no repository of its own.
ORIGIN=$(git remote get-url origin 2>/dev/null | sed -E 's#\.git$##; s#^.*[:/]([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$#\1#')
DEFAULT_REPO=${GH_REPO:-$ORIGIN}

US=$'\037'   # separates the words of one statement
UNKNOWN=$'\002' # stands in for the value of a $(...) or `...`

# split_statements: read shell text on stdin, print one statement per line with
# its words separated by \037. Quotes are removed and their content kept as part
# of the word (with any newline inside turned into a space); ; & | ( ) and
# newlines split statements only outside quotes; $(...) and `...` (also inside
# double quotes, where they still run) become statements of their own and leave
# \002 in the word that held them; a # comment and a heredoc body are dropped.
split_statements() {
  awk -v US="$US" -v UNK="$UNKNOWN" '
    { src = src (NR > 1 ? "\n" : "") $0 }
    function addc(ch) { word[d] = word[d] ch; inw[d] = 1 }
    function endw() { if (inw[d]) { stmt[d] = stmt[d] (nw[d]++ ? US : "") word[d]; word[d] = ""; inw[d] = 0 } }
    function ends() { endw(); if (nw[d]) print stmt[d]; stmt[d] = ""; nw[d] = 0 }
    function opensub(cl) { addc(UNK); d++; q[d] = ""; closer[d] = cl; par[d] = 0; word[d] = ""; inw[d] = 0; stmt[d] = ""; nw[d] = 0 }
    function closesub() { ends(); d-- }
    END {
      d = 0; q[0] = ""; closer[0] = ""; par[0] = 0; nhd = 0
      n = length(src)
      for (i = 1; i <= n; i++) {
        c = substr(src, i, 1); nx = substr(src, i + 1, 1)
        if (q[d] == "s") {
          if (c == "\047") q[d] = ""; else addc(c == "\n" ? " " : c)
          continue
        }
        if (q[d] == "d") {
          if (c == "\\" && (nx == "\"" || nx == "\\" || nx == "$" || nx == "`")) { addc(nx); i++ }
          else if (c == "\"") q[d] = ""
          else if (c == "$" && nx == "(") { opensub(")"); i++ }
          else if (c == "`") opensub("`")
          else addc(c == "\n" ? " " : c)
          continue
        }
        # code
        if (c == "\\") { if (nx != "\n") addc(nx); i++; continue }
        if (c == "\047") { q[d] = "s"; inw[d] = 1; continue }
        if (c == "\"") { q[d] = "d"; inw[d] = 1; continue }
        if (c == "$" && nx == "(") { opensub(")"); i++; continue }
        if (c == "`") { if (closer[d] == "`") closesub(); else opensub("`"); continue }
        if (c == ")" && closer[d] == ")" && par[d] == 0) { closesub(); continue }
        if (c == "(") { ends(); par[d]++; continue }
        if (c == ")") { ends(); if (par[d] > 0) par[d]--; continue }
        if (c == "#" && !inw[d]) { while (i < n && substr(src, i + 1, 1) != "\n") i++; continue }
        # A here-string (<<<) is a word of its own, not a heredoc.
        if (c == "<" && nx == "<" && substr(src, i + 2, 1) == "<") { endw(); addc("<<<"); i += 2; endw(); continue }
        if (c == "<" && nx == "<" && substr(src, i + 2, 1) != "<") {
          # Heredoc: remember its delimiter; the body starts after this line.
          endw(); j = i + 2
          if (substr(src, j, 1) == "-") j++
          while (substr(src, j, 1) == " " || substr(src, j, 1) == "\t") j++
          delim = ""
          while (j <= n) {
            ch = substr(src, j, 1)
            if (ch == " " || ch == "\t" || ch == "\n" || ch == ";" || ch == "&" || ch == "|" || ch == ")" || ch == "<" || ch == ">") break
            if (ch != "\047" && ch != "\"" && ch != "\\") delim = delim ch
            j++
          }
          if (delim != "") hd[++nhd] = delim
          i = j - 1; continue
        }
        if (c == "\n") {
          ends()
          # Skip any heredoc bodies that begin on the next line.
          for (h = 1; h <= nhd; h++) {
            while (i < n) {
              e = index(substr(src, i + 1), "\n"); line = (e ? substr(src, i + 1, e - 1) : substr(src, i + 1))
              i = (e ? i + e : n)
              sub(/^\t+/, "", line)
              if (line == hd[h]) break
            }
          }
          nhd = 0; continue
        }
        if (c == ";" || c == "&" || c == "|") { ends(); continue }
        if (c == " " || c == "\t") { endw(); continue }
        addc(c)
      }
      while (d > 0) closesub()
      ends()
    }'
}

TARGETS=()   # "owner/repo#number" (number "?" when it cannot be read)
# What a ready call looks like in raw text, for a script the hook cannot split.
STDIN_TRIGGERS='gh[[:space:]]+pr[[:space:]]+ready|post-board-verdict|ccr/ready_for_review|markPullRequestReadyForReview|board-verdict:[[:space:]]*PASS'
MATCHES=()   # the statement that produced each target, for the message
add_target() { TARGETS+=("$1"); MATCHES+=("$2"); }

# wrapper_opt_takes_arg <wrapper> <option>: does this wrapper option consume
# the next word as its value?
wrapper_opt_takes_arg() {
  case "$1:$2" in
    env:-u|env:--unset|env:-C|env:--chdir|env:-S|env:--split-string) return 0 ;;
    sudo:-u|sudo:-g|sudo:-h|sudo:-p|sudo:-C|sudo:-D|sudo:-R|sudo:-T|sudo:-U|sudo:-r|sudo:-t) return 0 ;;
    sudo:--user|sudo:--group|sudo:--host|sudo:--prompt|sudo:--chdir|sudo:--chroot) return 0 ;;
    time:-f|time:-o|time:--format|time:--output|nice:-n|nice:--adjustment) return 0 ;;
    ionice:-c|ionice:-n|ionice:-p|ionice:-P|ionice:-u|ionice:--class|ionice:--classdata) return 0 ;;
    stdbuf:-i|stdbuf:-o|stdbuf:-e|exec:-a) return 0 ;;
    timeout:-s|timeout:-k|timeout:--signal|timeout:--kill-after) return 0 ;;
    xargs:-n|xargs:-I|xargs:-L|xargs:-P|xargs:-d|xargs:-E|xargs:-s|xargs:-a) return 0 ;;
    xargs:--max-args|xargs:--max-lines|xargs:--max-procs|xargs:--delimiter|xargs:--eof|xargs:--replace|xargs:--arg-file|xargs:--max-chars) return 0 ;;
  esac
  return 1
}

# wrapper_opt_skips_next <wrapper> <option word>: does the NEXT word belong to
# this option? A merged short cluster (`-nu`) takes the next word when the
# first letter that takes a value is its last; an attached value (`-uFOO`)
# never does.
wrapper_opt_skips_next() {
  local w=$2 i
  if [[ "$w" =~ ^-[A-Za-z]{2,}$ ]]; then
    for ((i = 1; i < ${#w}; i++)); do
      if wrapper_opt_takes_arg "$1" "-${w:$i:1}"; then [ "$i" -eq $((${#w} - 1)) ]; return; fi
    done
    return 1
  fi
  wrapper_opt_takes_arg "$1" "$w"
}

# board_marker <text>: does it carry a PASS marker?
board_marker() { grep -qE 'board-verdict:[[:space:]]*PASS' <<<"$1"; }

# resolve_body <body>: a body built from a $(...) (the repo's own
# `--body "$(cat <<'EOF' ... EOF)"` idiom), a backtick or a variable is text
# the hook cannot read from the word itself, so the whole command, heredoc
# bodies and assignments included, is searched in its place.
resolve_body() {
  if [[ "$1" == *"$UNKNOWN"* || "$1" == *'$'* ]]; then printf '%s\n' "$1"; command_and_files; else printf '%s' "$1"; fi
}

# command_and_files: the command's own text, then each readable regular file
# the command feeds as a body (up to 1 MiB each): an argument of cat, a <
# redirect target, the value of -F/--body-file/--input, a key=@file. A body
# from `$(cat v.md)`, `-F - < v.md` or `cat v.md | gh pr comment N -F -` lives
# in such a file, not in the command. A file the command merely NAMES is not
# read: a reply saying "see scripts/board-verdict.sh" is not a PASS because
# that script contains the marker text.
command_and_files() {
  printf '%s\n' "$COMMAND"
  local f
  while IFS= read -r f; do
    [ -n "$f" ] && [ -f "$f" ] && [ -r "$f" ] || continue
    head -c 1048576 "$f" 2>/dev/null; printf '\n'
  done < <(body_files | sort -u)
}

# body_files: the paths command_and_files reads, one per line. cat's
# arguments run until a separator or a heredoc (<<), whose body is text, not
# file names.
body_files() {
  local tok prev="" incat=0
  while IFS= read -r tok; do
    case "$tok" in
      '|'|';'|'&'|'('|')'|'<<'|'<<<') incat=0; prev=$tok; continue ;;
    esac
    case "$prev" in -F|--body-file|--input|'<') printf '%s\n' "$tok" ;; esac
    case "$tok" in
      --body-file=*|--input=*) printf '%s\n' "${tok#*=}" ;;
      *=@*) printf '%s\n' "${tok#*=@}" ;;
      -*) ;;
      *) [ "$incat" -eq 0 ] || printf '%s\n' "$tok" ;;
    esac
    [ "${tok##*/}" != cat ] || incat=1
    prev=$tok
  done < <(grep -oE "<<<|<<|<|[|;&()]|[^[:space:]\"'<>|;&()]+" <<<"$COMMAND")
}

# A number as written in a call: digits (optionally #), else "?".
pr_number() { if [[ "$1" =~ ^#?([0-9]+)$ ]]; then echo "${BASH_REMATCH[1]}"; else echo "?"; fi; }

# read_file_or_marker <path>: a file's text. Stdin ("-") is a heredoc or pipe
# whose text is in the command itself, so the command is what is searched. A
# path that cannot be read is assumed to carry the marker, so it fails closed.
read_file_or_marker() {
  if [ "$1" = "-" ]; then command_and_files
  elif [ -r "$1" ] && [ -f "$1" ]; then cat "$1"
  else echo 'board-verdict: PASS'; fi
}

scan() { # <shell text> <depth>
  local text=$1 depth=$2 line
  [ "$depth" -le 3 ] || return 0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    local -a w=()
    IFS="$US" read -r -a w <<<"$line"
    local stmt_text=${line//$US/ } repo=$DEFAULT_REPO k=0
    # Leading assignments and wrappers. An option is skipped only inside a
    # wrapper, and an option that takes a value skips that value too
    # (`env -u NAME gh ...` would otherwise read NAME as the command).
    # timeout's first operand is its duration, not the command. xargs feeds
    # the command its arguments from stdin, so a gh pr ready behind it names
    # no PR the hook can read, and blocks.
    local wrap="" duration=0 runs=1 word
    while [ "$k" -lt "${#w[@]}" ]; do
      word=${w[$k]}
      # /usr/bin/env is env; an assignment's value may hold a / (GH_REPO=o/r).
      [[ "$word" != /* ]] || word=${word##*/}
      case "$word" in
        # gh treats an empty GH_REPO as unset: the current repository.
        GH_REPO=*) repo=${word#GH_REPO=}; repo=${repo:-$ORIGIN} ;;
        [A-Za-z_]*=*) ;;
        sudo|command|exec|time|nohup|env|nice|ionice|stdbuf|xargs) wrap=$word; duration=0 ;;
        timeout) wrap=timeout; duration=1 ;;
        then|do|else|elif|if|while|until|'!'|'{') wrap=""; duration=0 ;;
        -*)
          [ -n "$wrap" ] || break
          # `command -v`/`-V` only prints where a command is; it runs nothing.
          case "$wrap:$word" in command:-v|command:-V) runs=0; break ;; esac
          # `env -S 'cmd args'` (spaced, attached or long) runs the string.
          case "$wrap:$word" in
            env:-S|env:--split-string) scan "${w[$((k + 1))]:-}" $((depth + 1)) ;;
            env:-S?*) scan "${word#-S}" $((depth + 1)) ;;
            env:--split-string=*) scan "${word#*=}" $((depth + 1)) ;;
          esac
          if wrapper_opt_skips_next "$wrap" "$word"; then k=$((k + 1)); fi ;;
        *)
          if [ "$duration" -eq 1 ]; then duration=0; else break; fi ;;
      esac
      k=$((k + 1))
    done
    [ "$runs" -eq 1 ] || continue
    [ "$k" -lt "${#w[@]}" ] || continue
    local cmd=${w[$k]##*/}
    # A script handed to a shell or eval is read again.
    case "$cmd" in
      bash|sh|zsh|dash|ksh)
        local j=$((k + 1)) script=""
        while [ "$j" -lt "${#w[@]}" ]; do
          if [[ "${w[$j]}" =~ ^-[A-Za-z]*c[A-Za-z]*$ ]]; then script=${w[$((j + 1))]:-}; break; fi
          [[ "${w[$j]}" == [-+]* ]] || break
          # -o/+o/-O/+O take an option name (`bash -o pipefail -c ...`).
          case "${w[$j]}" in -o|+o|-O|+O) j=$((j + 1)) ;; esac
          j=$((j + 1))
        done
        # A here-string is the script itself: `bash <<< "gh pr ready N"`.
        if [ -z "$script" ] && [ "$j" -lt "${#w[@]}" ]; then
          case "${w[$j]}" in
            '<<<') script=${w[$((j + 1))]:-} ;;
            '<<<'?*) script=${w[$j]#<<<} ;;
          esac
        fi
        if [ -n "$script" ]; then scan "$script" $((depth + 1)); continue; fi
        # No -c and no script file: the shell reads its script from stdin (a
        # heredoc or a pipe). The hook does not run that text, so if the
        # command names a ready call anywhere, it blocks.
        if [ "$j" -ge "${#w[@]}" ] && grep -qE "$STDIN_TRIGGERS" <<<"$COMMAND"; then
          add_target "$repo#stdin" "$stmt_text (a script on stdin)"
          continue
        fi
        # `bash scripts/post-board-verdict.sh ...`: the script is the command.
        if [ "$j" -lt "${#w[@]}" ]; then k=$j; cmd=${w[$k]##*/}; fi
        ;;
      eval)
        scan "${w[*]:$((k + 1))}" $((depth + 1)); continue ;;
    esac
    local -a a=("${w[@]:$((k + 1))}")
    case "$cmd" in
      post-board-verdict.sh)
        local verdict=${a[1]:-}
        if [ "$verdict" = PASS ]; then
          add_target "$repo#$(pr_number "${a[0]:-}")" "$stmt_text"
        elif [[ "$verdict" == *'$'* || "$verdict" == *"$UNKNOWN"* ]]; then
          add_target "$repo#?" "$stmt_text"
        fi
        ;;
      gh)
        scan_gh "$repo" "$stmt_text" ${a[@]+"${a[@]}"} ;;
    esac
  done < <(split_statements <<<"$text")
}

scan_gh() { # <default repo> <statement text> <args after gh...>
  local repo=$1 stmt_text=$2; shift 2
  local -a a=("$@")
  local sub="${a[0]:-} ${a[1]:-}"
  case "$sub" in
    "pr ready")
      local undo=0 sel="" i=2
      while [ "$i" -lt "${#a[@]}" ]; do
        case "${a[$i]}" in
          --undo) undo=1 ;;
          -R|--repo) i=$((i + 1)); repo=${a[$i]:-} ;;
          --repo=*) repo=${a[$i]#--repo=} ;;
          -*) ;;
          *) [ -n "$sel" ] || sel=${a[$i]} ;;
        esac
        i=$((i + 1))
      done
      [ "$undo" -eq 0 ] || return 0
      if [[ "$sel" =~ ^https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/([0-9]+) ]]; then
        add_target "${BASH_REMATCH[1]}#${BASH_REMATCH[2]}" "$stmt_text"
      else
        add_target "$repo#$(pr_number "$sel")" "$stmt_text"
      fi
      ;;
    "pr comment"|"issue comment")
      local sel="" body="" i=2
      while [ "$i" -lt "${#a[@]}" ]; do
        case "${a[$i]}" in
          -b|--body) i=$((i + 1)); body+=$'\n'"${a[$i]:-}" ;;
          --body=*) body+=$'\n'"${a[$i]#--body=}" ;;
          -F|--body-file) i=$((i + 1)); body+=$'\n'"$(read_file_or_marker "${a[$i]:-}")" ;;
          --body-file=*) body+=$'\n'"$(read_file_or_marker "${a[$i]#--body-file=}")" ;;
          -R|--repo) i=$((i + 1)); repo=${a[$i]:-} ;;
          --repo=*) repo=${a[$i]#--repo=} ;;
          -*) ;;
          *) [ -n "$sel" ] || sel=${a[$i]} ;;
        esac
        i=$((i + 1))
      done
      board_marker "$(resolve_body "$body")" || return 0
      if [[ "$sel" =~ ^https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/(pull|issues)/([0-9]+) ]]; then
        add_target "${BASH_REMATCH[1]}#${BASH_REMATCH[3]}" "$stmt_text"
      else
        add_target "$repo#$(pr_number "$sel")" "$stmt_text"
      fi
      ;;
    api\ *)
      local route="" write=0 body="" i=1 v
      while [ "$i" -lt "${#a[@]}" ]; do
        v=${a[$i]}
        case "$v" in
          -X|--method) i=$((i + 1)); [ "${a[$i]:-GET}" = GET ] || write=1 ;;
          -f|-F|--field|--raw-field) i=$((i + 1)); write=1; body+=$'\n'"$(field_text "${a[$i]:-}")" ;;
          -f*|-F*) write=1; body+=$'\n'"$(field_text "${v:2}")" ;;
          --field=*|--raw-field=*) write=1; body+=$'\n'"$(field_text "${v#*=}")" ;;
          --input) i=$((i + 1)); write=1; body+=$'\n'"$(read_file_or_marker "${a[$i]:-}")" ;;
          -H|--header|-q|--jq|-t|--template|-p|--preview|--hostname|--cache) i=$((i + 1)) ;;
          -*) ;;
          *) [ -n "$route" ] || route=$v ;;
        esac
        i=$((i + 1))
      done
      route=${route#/}; route=${route%%\?*}
      # gh fills {owner}/{repo} from GH_REPO when set, else the current repository.
      route=${route/\{owner\}\/\{repo\}/$repo}
      if [[ "$route" =~ ^repos/([^/]+/[^/]+)/pulls/([^/]+)/ccr/ready_for_review$ ]]; then
        add_target "${BASH_REMATCH[1]}#$(pr_number "${BASH_REMATCH[2]}")" "$stmt_text"
      elif [[ "$route" == */ccr/ready_for_review ]]; then
        # A ready route the hook cannot read (repos//..., an odd placeholder)
        # names no PR it can check, so it blocks.
        add_target "$repo#?" "$stmt_text"
      elif [ "$route" = graphql ] && grep -q 'markPullRequestReadyForReview' <<<"$(resolve_body "$body")"; then
        add_target "$repo#?" "$stmt_text"
      elif [ "$write" -eq 1 ] && board_marker "$(resolve_body "$body")"; then
        if [[ "$route" =~ ^repos/([^/]+/[^/]+)/issues/([^/]+)/comments$ ]]; then
          add_target "${BASH_REMATCH[1]}#$(pr_number "${BASH_REMATCH[2]}")" "$stmt_text"
        else
          add_target "$repo#?" "$stmt_text"
        fi
      fi
      ;;
  esac
}

# scan_mcp: the GitHub MCP tools that mark a PR ready or post a PASS marker.
# The tool names its repository; a number that is missing blocks.
scan_mcp() {
  local name=${TOOL_NAME##*__} owner rname repo n body
  owner=$(jq -r '.tool_input.owner // empty' <<<"$_HOOK_INPUT" 2>/dev/null)
  rname=$(jq -r '.tool_input.repo // empty' <<<"$_HOOK_INPUT" 2>/dev/null)
  repo="$owner/$rname"
  case "$name" in
    update_pull_request)
      [ "$(jq -r '.tool_input.draft | tostring' <<<"$_HOOK_INPUT" 2>/dev/null)" = false ] || return 0
      n=$(jq -r '.tool_input.pullNumber // .tool_input.pull_number // empty' <<<"$_HOOK_INPUT" 2>/dev/null)
      add_target "$repo#$(pr_number "$n")" "$TOOL_NAME draft=false" ;;
    add_issue_comment|update_issue_comment)
      body=$(jq -r '.tool_input.body // empty' <<<"$_HOOK_INPUT" 2>/dev/null)
      board_marker "$body" || return 0
      # An edited comment is named by comment id, not by PR, so it blocks.
      n=$(jq -r '.tool_input.issue_number // .tool_input.issueNumber // empty' <<<"$_HOOK_INPUT" 2>/dev/null)
      if [ "$name" = update_issue_comment ] && [ -z "$n" ]; then n=comment; else n=$(pr_number "$n"); fi
      add_target "$repo#$n" "$TOOL_NAME (board-verdict: PASS)" ;;
  esac
}

# field_text <key=value>: the value of a gh api field, reading key=@file.
field_text() {
  local v=${1#*=}
  if [[ "$v" == @* ]]; then read_file_or_marker "${v#@}"; else printf '%s' "$v"; fi
}

if [ -n "$COMMAND" ]; then scan "$COMMAND" 0; else scan_mcp; fi
[ "${#TARGETS[@]}" -gt 0 ] || exit 0

command -v gh >/dev/null 2>&1 || block "gh is not installed, so readiness cannot be checked" "Install gh, or check the PR by hand."
command -v jq >/dev/null 2>&1 || block "jq is not installed, so readiness cannot be checked" "Install jq, or check the PR by hand."

SEEN=" "
for idx in "${!TARGETS[@]}"; do
  target=${TARGETS[$idx]}
  case "$SEEN" in *" $target "*) continue ;; esac
  SEEN+="$target "
  MATCHED=${MATCHES[$idx]//$UNKNOWN/\$(...)}
  REPO=${target%#*}; pr=${target##*#}
  if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    if [ -z "$COMMAND" ]; then
      block "$TOOL_NAME was called without its owner and repo arguments, so the repository cannot be told" "Pass owner and repo to the tool."
    fi
    block "cannot tell which repository this PR is in (got '$REPO')" "Name the repository with -R owner/repo."
  fi
  [ "$pr" != "stdin" ] \
    || block "a script fed to a shell on stdin names a ready call, and the hook cannot read which PR it marks" "Run the ready call as a plain command (gh pr ready N), not inside a script on stdin."
  [ "$pr" != "comment" ] \
    || block "an edited comment is named by its comment id, so the PR its PASS marker is for cannot be read" "Post the PASS as a new comment instead (add_issue_comment with issue_number, or gh pr comment N)."
  [ "$pr" != "?" ] \
    || block "cannot read which PR this call marks ready or passes: it is without a PR number (none given, a variable, or a GraphQL node id)" "Name each PR as a literal number, one call per PR."
  P="$REPO#$pr"

  budget_check
  info=$(ghc api "repos/$REPO/pulls/$pr" 2>/dev/null) || fail "cannot read PR $P from GitHub" "Check the PR number and your gh access, then retry."
  head=$(jq -r '.head.sha // empty' <<<"$info" 2>/dev/null)
  state=$(jq -r '.mergeable_state // empty' <<<"$info" 2>/dev/null)
  [[ "$head" =~ ^[0-9a-f]{40}$ ]] || block "$P: GitHub returned no head commit" "Retry in a few seconds."

  # 1. Review threads, by GitHub's own resolved flag.
  budget_check
  if threads=$(ghc api "repos/$REPO/pulls/$pr/ccr/review_threads" 2>/dev/null) \
    && jq -e 'type == "array"' >/dev/null 2>&1 <<<"$threads"; then
    open=$(jq -r '[.[] | select(.resolved != true)] | map("\(.path // "?"):\(.line // "?") (comment \(.comment_ids[0] // "?"))")' <<<"$threads")
  else
    owner=${REPO%%/*}; name=${REPO#*/}
    # shellcheck disable=SC2016  # GraphQL variables, not shell expansions
    query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved path line comments(first:1){nodes{databaseId}}}}}}}'
    budget_check
    gq=$(ghc api graphql -f query="$query" -f o="$owner" -f r="$name" -F n="$pr" 2>/dev/null) \
      || fail "$P: cannot read its review threads (neither the ccr/review_threads route nor GraphQL answered)" "Retry; if it persists, check the threads on GitHub by hand."
    t='.data.repository.pullRequest.reviewThreads'
    jq -e "$t.nodes | type == \"array\"" >/dev/null 2>&1 <<<"$gq" \
      || block "$P: the GraphQL review-thread answer had no thread list" "Retry; if it persists, check the threads on GitHub by hand."
    [ "$(jq -r "$t.pageInfo.hasNextPage" <<<"$gq")" = "false" ] \
      || block "$P: more than 100 review threads; check them by hand" "Check the threads on GitHub by hand."
    open=$(jq -r "[$t.nodes[] | select(.isResolved != true)] | map(\"\(.path // \"?\"):\(.line // \"?\") (comment \(.comments.nodes[0].databaseId // \"?\"))\")" <<<"$gq")
  fi
  n_open=$(jq length <<<"$open")
  [ "$n_open" -eq 0 ] || block "$P has unresolved review threads: $(jq -r '.[:5] | join(", ")' <<<"$open")$([ "$n_open" -le 5 ] || echo ", ...") ($n_open open)" \
    "Read them (gh api repos/$REPO/pulls/$pr/ccr/review_threads, or the PR page), fix or answer each one, resolve it, then retry."

  # 2. Checks on the current head.
  budget_check
  checks=$(ghc api --paginate "repos/$REPO/commits/$head/check-runs?per_page=100" 2>/dev/null) \
    || fail "$P: cannot read the check runs on ${head:0:8}" "Retry in a few seconds."
  # A check that ran more than once (a re-run, or a run superseded by a newer
  # trigger and cancelled) is judged by its LATEST run, as GitHub does: one
  # check per name and app, the highest run id.
  checks=$(jq -s '[.[].check_runs[]?] | group_by([.name, (.app.id // 0)]) | map(max_by(.id))' <<<"$checks" 2>/dev/null) \
    || block "$P: the check-run answer for ${head:0:8} was not JSON" "Retry in a few seconds."
  [ "$(jq length <<<"$checks")" -gt 0 ] || block "$P: no check has run on ${head:0:8} yet" "Wait for CI to start, then retry."
  failed=$(jq -r '[.[] | select(.conclusion | IN("failure","timed_out","cancelled","startup_failure","action_required")) | .name] | unique | join(", ")' <<<"$checks")
  [ -z "$failed" ] || block "$P: checks did not pass on ${head:0:8}: $failed" "Fix the failure and push, or re-run a check that died before its tests ran."
  pending=$(jq -r '[.[] | select(.status != "completed") | .name] | unique | join(", ")' <<<"$checks")
  [ -z "$pending" ] || block "$P: checks still running on ${head:0:8}: $pending" "Wait for them to finish, then retry."

  # 2b. Legacy commit statuses: failed or error blocks, and so does pending,
  # except review-board's (pending until the PASS this hook guards is posted).
  budget_check
  statuses=$(ghc api "repos/$REPO/commits/$head/status?per_page=100" 2>/dev/null) \
    || fail "$P: cannot read the commit statuses on ${head:0:8}" "Retry in a few seconds."
  bad_status=$(jq -r '[.statuses[]? | select(.state == "failure" or .state == "error" or (.state == "pending" and .context != "review-board")) | "\(.context) (\(.state))"] | unique | join(", ")' <<<"$statuses" 2>/dev/null) \
    || block "$P: the commit-status answer for ${head:0:8} was not JSON" "Retry in a few seconds."
  [ -z "$bad_status" ] || block "$P: commit statuses not passing on ${head:0:8}: $bad_status" "Fix a failed status, or wait for a pending one, then retry."
  [ "$(jq '(.total_count // 0) > ((.statuses // []) | length)' <<<"$statuses")" = false ] \
    || block "$P: more than 100 commit statuses on ${head:0:8}; check them by hand" "Check the statuses on GitHub by hand."

  # 3. Mergeability.
  case "$state" in
    dirty) block "$P has a merge conflict with its base" "Merge the base branch into the PR, resolve the conflict, push, then retry." ;;
    unknown|"") block "$P: GitHub has not finished computing mergeability" "Retry in a few seconds." ;;
  esac
done
exit 0
