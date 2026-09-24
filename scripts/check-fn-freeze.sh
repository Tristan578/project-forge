#!/usr/bin/env bash
# check-fn-freeze.sh — every function a bash self-defense suite defines must be
# frozen with `readonly -f <name>` on the line directly after its definition.
#
# THE BUG THIS EXISTS FOR (PF-1076 / #9125)
# ------------------------------------------
# A bash function is resolved BY NAME AT CALL TIME. Pinning the file text of a
# function's definition therefore proves nothing about the binding a later
# caller resolves: one inserted line —
#
#     fail() { :; }
#
# — anywhere between the definition and the assertions that call it turns every
# FAIL into silence, and the suite exits 0 having checked nothing. Measured on
# `scripts/__tests__/check-npm-audit.test.sh` before it was frozen: with its
# gate deliberately degated, that single line scored 228 PASS / 0 FAIL, exit 0,
# byte-identical to the clean control (docs/guides/npm-audit-gate-hardening.md,
# round 40). Measured again for this sweep on the untouched tree: 45 of the 46
# suites that define a `fail`/`bad` helper stayed at exit 0 with that helper
# neutered and a forced failure called immediately after.
#
# `readonly -f name` closes it: bash refuses to rebind a readonly function
# (`bash: name: readonly function`, status 1) on every version from 3.2 up,
# including Git Bash on Windows. The constraint that shapes this gate is that
# `readonly -f` CANNOT PRE-DECLARE — `readonly -f g` before `g` exists is
# `readonly: g: not a function` — so a single freeze block at the end of a file
# is impossible; an attacker would define-then-get-frozen. Every freeze must
# follow its own definition, and this gate asserts exactly that shape.
#
# THE RULE
# --------
# For every top-level function definition in a scanned file (`name() {`,
# `function name() {` or `function name {`, at column 0, outside heredocs and
# comments), the line IMMEDIATELY after the definition's closing brace must be
# exactly `readonly -f name`. The body must be a brace group, opened on the
# definition line or on the next non-blank, non-comment line; a one-line
# definition closes where its own line ends (a trailing comment is not part of
# it), and a multi-line definition closes at the first later line that starts
# with `}` at column 0. A definition whose body is anything else — a subshell
# `( )`, a bare `if`/`while`/`case` — is reported as `unsupported` and fails
# the gate, so a helper the derivation cannot follow is never a helper it
# silently forgot (the sixth board round found `name()` with the brace on
# the next line, and a one-liner with a trailing comment, both invisible).
# Any other `readonly -f X` line is a stray: it either names a function this
# file never defines, or sits somewhere other than directly after X's
# definition (a pre-declaration, or a freeze with a window before it).
#
# The freeze protects the FUNCTION binding and nothing else. A bash alias of
# the same name is resolved before functions once `shopt -s expand_aliases`
# is on, so `alias fail=:` after a frozen `fail()` takes every later call
# without an error, and neither line is a definition or a freeze. A
# self-defense suite has no use for aliases, so the gate reports the WORDS
# `alias NAME=` and `shopt -s expand_aliases` wherever they occur in
# executable text, after the quote removal and backslash unescaping bash
# itself performs before it looks a command up: `\alias`, `"alias"`,
# `al"ias"`, `\a\l\i\a\s`, `$'alias'`, a backslash line continuation in the
# middle of the statement, and anything in front of the word (`builtin`,
# `command`, `time -p`, `X="1"`, `!`, `if`) are all the same word. A word
# assembled at run time — `$x`, `$(...)`, `eval`, a `source` of a file
# written by the suite — is not a word this scan can see, and `declare -n`
# is a variable, not a function: those remain outside this gate (round 39
# of the guide).
#
# Indented definitions are deliberately out of scope: they are nested inside
# another function, an `if` arm, or a subshell, and a function defined inside a
# body that runs more than once cannot be frozen on its first run without
# breaking its second. The top-level helpers — pass/fail/ok/bad and every fixture
# builder the assertions route through — are the ones a one-line rebind neuters.
#
# The derivation is the single implementation of "what does this file define":
# `--list` prints it as TSV so the sweep tool and the tests read the same
# answer the gate acts on (lessons-learned #18: derive the subject, never
# restate it).
#
# Exit codes: 0 every definition frozen; 1 at least one violation; 2 tooling
# or vacuity error (no files, or no definitions — a gate that scans nothing is
# not a passing gate, lesson #9).
#
# Usage:
#   bash scripts/check-fn-freeze.sh           # check, report violations
#   bash scripts/check-fn-freeze.sh --list    # TSV: file, name, def line, end line, status
#
# FN_FREEZE_DIRS is a TEST-ONLY seam (space-separated, relative to the repo
# root or absolute). check-fn-freeze.test.sh asserts no workflow sets it, so
# the gate cannot be pointed at an empty tree from CI config.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || ROOT="$(pwd)"
DIRS="${FN_FREEZE_DIRS:-scripts/__tests__ scripts/__tests__/lib .claude/hooks/__tests__ .claude/tools/__tests__}"

mode=check
case "${1:-}" in
  --list) mode=list ;;
  '') ;;
  *) echo "usage: $0 [--list]" >&2; exit 2 ;;
esac

resolve() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$ROOT/$1" ;;
  esac
}
readonly -f resolve

# One awk program derives every definition and every freeze in a file ($1,
# reported under the display path $2) and prints one TSV row per definition
# plus one per stray freeze:
#   <file> \t <name> \t <def line> \t <end line> \t frozen|unfrozen|stray|alias|unsupported
# Only column-0 lines that start OUTSIDE a quoted region count: the program
# lexes single quotes, double quotes, $'...' strings, backslash escapes,
# `$(`/`(` contexts (a `$(` inside double quotes opens a fresh quoting
# context, as bash does) and comments, and it skips heredoc bodies. That is
# what keeps an awk program written as `NAME='...function flush() {...'`, or
# a fixture written from a heredoc, from reading as a bash definition — the
# sweep that introduced this gate broke a suite by freezing exactly such a
# line inside a quoted awk program.
derive_file() {
  awk -v file="$2" '
    function flush_def() {
      pending_name = def_name; pending_def = def_line; pending_end = NR
      def_name = ""
    }
    # The text of a line before its trailing comment, with the quoting of the
    # line respected (a `#` inside quotes is text). Used to decide whether
    # a definition line closes its own brace group.
    function code_part(s,   n, i, c, qq) {
      n = length(s); qq = ""
      for (i = 1; i <= n; i++) {
        c = substr(s, i, 1)
        if (qq == "s") { if (c == "\047") qq = ""; continue }
        if (qq == "d") { if (c == "\\") { i++; continue } if (c == "\"") qq = ""; continue }
        if (c == "\\") { i++; continue }
        if (c == "\047") { qq = "s"; continue }
        if (c == "\"") { qq = "d"; continue }
        if (c == "#" && (i == 1 || substr(s, i - 1, 1) ~ /[[:space:];(&|{]/)) return substr(s, 1, i - 1)
      }
      return s
    }
    # Advance the lexer over one line, updating the quote state (q), the
    # context stack (d, st_q[]) and the heredoc queue (hd_n, hd_term[]).
    # The scan also TOKENISES executable text into words the way bash does
    # before it looks a command up: quotes of every kind are removed and the
    # pieces joined (al"ias", the word in single or $ quotes), a backslash
    # escapes the next character
    # (`\a\l\i\a\s`), and whitespace or a control operator ends the word. The
    # alias rule is then a check on the WORDS of a statement: the COMMAND
    # word is the first word that is not an assignment (`X="1"`) and not one
    # of the words bash lets stand in front of a command (`builtin`,
    # `command`, `time`, `-p`, `!`, `if`/`then`/`else`/`do`/`while`/..., `{`).
    # When that word is `alias`, every later `NAME=` word in the statement is
    # a violation (`alias nothing fail=:` still binds fail); when it is
    # `shopt` and an s flag cluster follows, a later `expand_aliases` is one
    # (`shopt -s nocasematch expand_aliases` still turns it on). A statement
    # ends at `;`, `&`, `|`, `(`, `)` or a line end that is not a
    # continuation. That is what makes `\alias`, `builtin alias`, `command
    # alias`, `X="1" alias`, `"alias" fail=:` and `\a\l\i\a\s fail=:` all one
    # case — each spells the same command word — instead of a list of
    # prefixes that the review board extended twice and could always extend
    # again, while `echo alias fail=:` (the word as an ARGUMENT) is text. A
    # word assembled at run time (`$x`, `$(...)`, `eval`, a sourced file) is
    # not a word this scan can see; that is the documented bound.
    function end_word() {
      if (w == "") return
      if (!cmd_seen) {
        # Still looking for the command word of this statement.
        if (w ~ /^(builtin|command|time|-p|!|if|then|elif|else|do|while|until|coproc|\{|\})$/ ||
            w ~ /^[A-Za-z_][A-Za-z0-9_]*=/) { w = ""; return }
        cmd_seen = 1
        if (w == "alias") in_alias = 1
        if (w == "shopt") in_shopt = 1
        w = ""; return
      }
      if (in_alias && w ~ /^[A-Za-z_][A-Za-z0-9_]*=/)
        printf "%s\t%s\t%d\t%d\talias\n", file, "alias " w, NR, NR
      if (in_shopt && sflag != "" && w == "expand_aliases")
        printf "%s\t%s\t%d\t%d\talias\n", file, "shopt " sflag " " w, NR, NR
      if (in_shopt && w ~ /^-[a-z]*s[a-z]*$/) sflag = w
      w = ""
    }
    function end_command() { end_word(); cmd_seen = 0; in_alias = 0; in_shopt = 0; sflag = "" }
    # Entering `$( ... )` or `( ... )` starts a new context: the enclosing
    # quote state and the enclosing array-literal state are both pushed and
    # both cleared, and the matching `)` restores them. Array-literal skipping
    # must be cleared here, not only quoting: `arr=($(alias fail=:))` stores
    # the OUTPUT of a command that runs, so its text is code (the sixth board
    # round found a single global array flag swallowing it as literal words).
    function open_sub(saved_q) {
      end_command(); d++
      st_q[d] = saved_q; st_arr[d] = arr; st_arrd[d] = arr_d
      q = ""; arr = 0; arr_d = 0
    }
    function close_sub() {
      end_command()
      if (d > 0) { q = st_q[d]; arr = st_arr[d]; arr_d = st_arrd[d]; d-- }
    }
    function lex_line(line,   n, i, c, c2, c3, rest, tok, carry) {
      n = length(line); i = 1
      # A trailing unquoted backslash joins this line to the next one, so the
      # word and the two words before it carry over (`alias \` + `fail=:`,
      # or `al\` + `ias`, are one statement to bash).
      carry = cont; cont = 0
      if (q == "" && !carry) { cmd_seen = 0; in_alias = 0; in_shopt = 0; sflag = ""; w = "" }
      while (i <= n) {
        c = substr(line, i, 1); c2 = substr(line, i, 2); c3 = substr(line, i, 3)
        if (q == "s") { if (c == "\047") q = ""; else w = w c; i++; continue }
        if (q == "a") {
          if (c == "\\") { w = w substr(line, i + 1, 1); i += 2; continue }
          if (c == "\047") q = ""; else w = w c
          i++; continue
        }
        if (q == "d") {
          if (c == "\\") { w = w substr(line, i + 1, 1); i += 2; continue }
          if (c == "\"") { q = ""; i++; continue }
          if (c2 == "$(") { open_sub(q); i += 2; continue }
          w = w c; i++; continue
        }
        if (arr) {
          if (c == "\\") { i += 2; continue }
          if (c2 == "$\047") { q = "a"; i += 2; continue }
          if (c == "\047") { q = "s"; i++; continue }
          if (c == "\"") { q = "d"; i++; continue }
          if (c2 == "$(") { open_sub(""); i += 2; continue }
          if (c == "(") arr_d++
          if (c == ")") { arr_d--; if (arr_d == 0) { arr = 0; w = "" } }
          i++; continue
        }
        if (c == "\\") {
          if (i == n) { cont = 1; i++; continue }
          w = w substr(line, i + 1, 1); i += 2; continue
        }
        if (c2 == "$\047") { q = "a"; i += 2; continue }
        if (c == "\047") { q = "s"; i++; continue }
        if (c == "\"") { q = "d"; i++; continue }
        if (c == "#") {
          if (i == 1 || substr(line, i - 1, 1) ~ /[[:space:];(&|]/) { end_word(); break }
          w = w c; i++; continue
        }
        if (c2 == "$(") { open_sub(""); i += 2; continue }
        # `NAME=(` / `NAME+=(` opens an ARRAY LITERAL: its elements are words
        # that are stored, never run, so none of them can be a command word.
        # The group is skipped to its closing paren (quotes inside it are
        # still tracked so a `)` in a string does not end it early), except
        # that a `$( )` inside it is a command that runs and is lexed as one.
        if (c == "(" && w ~ /^[A-Za-z_][A-Za-z0-9_]*\+?=$/) { arr = 1; arr_d = 1; w = ""; i++; continue }
        if (c == "(") { open_sub(""); i++; continue }
        if (c == ")") { close_sub(); i++; continue }
        if (c3 == "<<<") { end_word(); i += 3; continue }
        if (c2 == "<<") {
          end_word()
          rest = substr(line, i + 2)
          strip = (substr(rest, 1, 1) == "-")
          sub(/^-?[[:space:]]*/, "", rest)
          if (match(rest, /^(\047[A-Za-z_][A-Za-z0-9_]*\047|"[A-Za-z_][A-Za-z0-9_]*"|\\?[A-Za-z_][A-Za-z0-9_]*)/)) {
            tok = substr(rest, RSTART, RLENGTH)
            gsub(/[\047"\\]/, "", tok)
            hd_n++; hd_term[hd_n] = tok; hd_strip[hd_n] = strip
            i += 2 + (length(line) - i - 1 - length(rest)) + RLENGTH
            continue
          }
          i += 2; continue
        }
        if (c ~ /[;&|]/) { end_command(); i++; continue }
        if (c ~ /[[:space:]<>]/) { end_word(); i++; continue }
        w = w c; i++
      }
      if (q == "" && !cont) end_word()
    }
    {
      line = $0

      # Inside a heredoc body: only its terminator matters.
      # Only a `<<-` heredoc lets bash strip leading tabs before matching
      # the terminator; a plain `<<` needs the delimiter byte-exact at column
      # 0, and a tab-indented body line spelling the delimiter is body text.
      if (hd_n > 0) {
        t = line; if (hd_strip[1]) sub(/^\t+/, "", t)
        if (t == hd_term[1]) {
          for (k = 1; k < hd_n; k++) { hd_term[k] = hd_term[k + 1]; hd_strip[k] = hd_strip[k + 1] }
          hd_n--
        }
        next
      }

      # Line-level classification applies only when the line STARTS outside
      # a quoted region; otherwise the line is string content.
      if (q != "") {
        if (line ~ /^readonly -f [A-Za-z_][A-Za-z0-9_]*[[:space:]]*$/) {
          n2 = line; sub(/^readonly -f /, "", n2); sub(/[[:space:]]*$/, "", n2)
          printf "%s\t%s\t%d\t%d\tstray\n", file, n2, NR, NR
        }
        lex_line(line)
        next
      }

      # Resolve a deferred definition: the line right after its closing brace.
      if (pending_name != "") {
        if (line ~ ("^readonly -f " pending_name "[[:space:]]*$")) {
          printf "%s\t%s\t%d\t%d\tfrozen\n", file, pending_name, pending_def, pending_end
          pending_name = ""
          next
        }
        printf "%s\t%s\t%d\t%d\tunfrozen\n", file, pending_name, pending_def, pending_end
        pending_name = ""
      }

      # A definition whose brace group opens on a later line: skip blank and
      # comment lines, accept a line whose first token is `{` (closing on that
      # same line if it ends the group), and report anything else as an
      # unsupported body rather than losing the definition.
      if (def_name != "" && brace_pending) {
        if (line ~ /^[[:space:]]*$/ || line ~ /^[[:space:]]*#/) next
        if (line ~ /^[[:space:]]*\{/) {
          brace_pending = 0
          body = code_part(line); sub(/[[:space:]]+$/, "", body)
          if (body ~ /\}$/ && body !~ /^[[:space:]]*\{[[:space:]]*$/) flush_def()
          lex_line(line); next
        }
        printf "%s\t%s\t%d\t%d\tunsupported\n", file, def_name, def_line, NR
        brace_pending = 0; def_name = ""
      }

      # Inside a multi-line definition: the column-0 closing brace ends it.
      if (def_name != "") {
        if (line ~ /^\}/) { flush_def(); next }
        lex_line(line)
        next
      }

      if (line ~ /^[[:space:]]*#/) next

      # A top-level definition opener, column 0 only: `name()`, `function
      # name()` or `function name`, with the optional bash whitespace inside the
      # parens (`fail ( ) {` is a real, freezable function — the fifth board
      # round found the adjacent-only pattern left such a helper invisible).
      # What follows the opener on the line decides the body: nothing (after
      # the comment is removed) means the brace group opens on a later line;
      # `{` means it opens here and closes here if the code part ends in `}`;
      # anything else is a body this derivation does not follow, reported.
      name = ""; rest = ""
      if (match(line, /^(function[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\([[:space:]]*\)/)) {
        name = substr(line, RSTART, RLENGTH); rest = substr(line, RLENGTH + 1)
        sub(/^function[[:space:]]+/, "", name); sub(/[[:space:]]*\([[:space:]]*\)$/, "", name)
      } else if (match(line, /^function[[:space:]]+[A-Za-z_][A-Za-z0-9_]*/)) {
        name = substr(line, RSTART, RLENGTH); rest = substr(line, RLENGTH + 1)
        sub(/^function[[:space:]]+/, "", name)
      }
      if (name != "") {
        body = code_part(rest); sub(/^[[:space:]]+/, "", body); sub(/[[:space:]]+$/, "", body)
        def_name = name; def_line = NR
        if (body == "") { brace_pending = 1; next }
        if (body ~ /^\{/) {
          if (body ~ /\}$/) flush_def()
          lex_line(line); next
        }
        printf "%s\t%s\t%d\t%d\tunsupported\n", file, name, NR, NR
        def_name = ""
        lex_line(line); next
      }

      # A freeze that is not the resolution of a pending definition is a stray.
      if (match(line, /^readonly -f [A-Za-z_][A-Za-z0-9_]*[[:space:]]*$/)) {
        n2 = line; sub(/^readonly -f /, "", n2); sub(/[[:space:]]*$/, "", n2)
        printf "%s\t%s\t%d\t%d\tstray\n", file, n2, NR, NR
        next
      }

      lex_line(line)
    }
    END {
      if (pending_name != "")
        printf "%s\t%s\t%d\t%d\tunfrozen\n", file, pending_name, pending_def, pending_end
      if (def_name != "" && brace_pending)
        printf "%s\t%s\t%d\t%d\tunsupported\n", file, def_name, def_line, NR
      else if (def_name != "")
        printf "%s\t%s\t%d\t%d\tunfrozen\n", file, def_name, def_line, NR
      # A lexer that ends the file inside a heredoc or a quoted string has
      # skipped everything after the opener; that is a parse failure, not a
      # clean file, and the gate must not report the skipped tail as frozen.
      if (hd_n > 0)
        printf "%s\t%s\t%d\t%d\tparse-error\n", file, "unterminated heredoc <<" hd_term[1], NR, NR
      else if (q != "")
        printf "%s\t%s\t%d\t%d\tparse-error\n", file, "unterminated quoted string", NR, NR
    }
  ' "$1"
}
readonly -f derive_file

files=()
for dir in $DIRS; do
  scan_dir="$(resolve "$dir")"
  if [ ! -d "$scan_dir" ]; then
    echo "::error::check-fn-freeze: scanned directory not found: $scan_dir" >&2
    exit 2
  fi
  shopt -s nullglob
  # Suites everywhere; plain .sh only in a lib/ directory (a sourced library
  # is frozen too, because the suites that source it call its helpers).
  case "$scan_dir" in
    */lib) found=("$scan_dir"/*.sh) ;;
    *)     found=("$scan_dir"/*.test.sh) ;;
  esac
  shopt -u nullglob
  files+=("${found[@]}")
done

if [ ${#files[@]} -eq 0 ]; then
  echo "::error::check-fn-freeze: no shell suites found under: $DIRS — refusing to report success having checked nothing" >&2
  exit 2
fi

rows=""
for f in "${files[@]}"; do
  rel="${f#"$ROOT"/}"
  out="$(derive_file "$f" "$rel")"
  [ -n "$out" ] && rows="${rows}${out}"$'\n'
done

if [ "$mode" = list ]; then
  printf '%s' "$rows"
  exit 0
fi

parse_errors="$(grep -E $'\tparse-error$' <<<"$rows" || true)"
if [ -n "$parse_errors" ]; then
  echo "::error::check-fn-freeze: the derivation could not parse to the end of file — every definition after the opener would be invisible to this gate (fail closed):" >&2
  while IFS=$'\t' read -r file what line _rest; do
    [ -n "$file" ] || continue
    echo "  - $file: $what still open at line $line" >&2
  done <<<"$parse_errors"
  exit 2
fi

total="$(grep -cE $'\t(frozen|unfrozen)$' <<<"$rows" || true)"
if [ "${total:-0}" -eq 0 ]; then
  echo "::error::check-fn-freeze: ${#files[@]} file(s) scanned and no function definition derived — either the derivation broke or the suites define nothing (fail closed)" >&2
  exit 2
fi

violations="$(grep -E $'\t(unfrozen|stray|alias|unsupported)$' <<<"$rows" || true)"
if [ -n "$violations" ]; then
  count="$(grep -c '' <<<"$violations")"
  # The report is the block reason, so it goes to stderr like every other
  # error path here (the harness surfaces stderr; stdout is dropped).
  {
    echo "::error::check-fn-freeze: $count violation(s) across ${#files[@]} file(s) ($total definition(s) derived). A function that is not frozen can be rebound by one inserted line, which silently neuters every assertion whose evidence passes through it:"
    while IFS=$'\t' read -r file name def end status; do
      [ -n "$file" ] || continue
      case "$status" in
        unfrozen) echo "  - $file:$def: $name() is not frozen — add 'readonly -f $name' on line $((end + 1)), directly after its closing brace" ;;
        stray)    echo "  - $file:$def: 'readonly -f $name' does not directly follow a top-level definition of $name() — a freeze before the definition cannot bind, a freeze with a window after it leaves that window open, and a freeze inside a quoted string or fixture is text, not a statement" ;;
        alias)    echo "  - $file:$def: '$name' — 'readonly -f' freezes the function binding, not the name: once expand_aliases is on an alias takes every later call of a frozen helper, so a self-defense suite may not define an alias or enable alias expansion" ;;
        unsupported) echo "  - $file:$def: $name() has a body this gate cannot follow (not a brace group opened on the definition line or the next) — write it as '$name() {' ... '}' with the closing brace at column 0, then freeze it on the next line" ;;
      esac
    done <<<"$violations"
  } >&2
  exit 1
fi

echo "check-fn-freeze: $total function(s) across ${#files[@]} file(s) are frozen with readonly -f directly after their definition"
exit 0
