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
# round 40). Measured again for this sweep on main at a525ca4a: 46 of the 52
# suites that define a `fail`/`bad` helper stayed at exit 0 with that helper
# neutered and a forced failure called immediately after; only the 6 already
# frozen there (check-npm-audit.test.sh and five hook suites) went red.
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
# definition line or on the next non-blank, non-comment line; a definition
# closes on its own line when its closing brace stands there in command
# position, as bash reads it, whatever code follows (`f() { :; }; true`
# closes there, while in `f() { echo }` the brace is an argument and the next
# line is still the body; the word after fi, done or esac is in command
# position, so `h() { if true; then :; fi }` closes too; a trailing comment
# is not part of the line: the thirty-second and thirty-third board rounds),
# and otherwise where the lexer sees the brace of its group close in command
# position on a later line, which must be a line that starts with `}` at
# column 0. A multi-line body whose brace closes anywhere else (an indented
# `}`), or never, is reported as `close`: the freeze rule cannot tie it to a
# freeze line (thirty-fifth board round: such a body stayed open until a
# later function column-0 brace, and that function and its freeze were
# misreported). A column-0 brace that closes only a group nested in the
# body does not end it: the body goes on, and a definition after that brace
# is nested. Code after the definition OWN closing brace on its line is top
# level (thirty-sixth round: the first column-0 brace ended the definition,
# and code after the closing brace was read as still inside it). A definition
# whose body is anything else — a subshell
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
# itself performs before it looks a command up (inside double quotes a
# backslash escapes only a dollar, a backtick, a double quote, a backslash or
# a newline and is otherwise kept, so `"al\ias"` is not alias: the
# thirty-second round): `\alias`, `"alias"`,
# `al"ias"`, `\a\l\i\a\s`, `$'alias'` and its escaped forms (octal, hex,
# `\u`, `\U`, a NUL ending the value), a backslash line continuation in the
# middle of the statement, and anything in front of the word (`builtin`,
# `command`, `time -p`, a prefix assignment, `!`, `if`, and a redirection
# with its target: `>/tmp/x`, `2>&1`, `<<<x`, the thirty-eighth round) are
# all the same word. A process substitution (`<( )`, `>( )`, thirty-ninth
# round) and a backtick span (fortieth) are lexed like `$( )`: part of the
# word they sit in, their contents a statement of their own, and the
# statement around them resumed when they close. A prefix assignment is `NAME=` or `NAME+=`, or a word
# that starts `NAME[` and holds `]=` or `]+=` anywhere: a subscript is not
# parsed (thirty-seventh round: quotes, escapes, nesting and blanks inside
# one each defeated an attempt to follow it), so this over-reports at worst.
# A command word that starts `NAME[` with more words after it is a subscript
# split at a blank (`a[1 + 1]=5 alias fail=:` binds the alias) and is
# reported as `subscript`. And so
# is a word spelled around an expansion that can be empty (`ali$()as`,
# `ali${x:+Q}as`, `DEBU$1G`): every command name and argument is also judged
# with its expansions removed (see end_word), an ANSI-C string decoded, a
# locale string read as its text, and every word a brace group expands to
# (`al{i,}as`) checked; an expansion too long to enumerate, in a guarded
# position, is reported as `brace` rather than judged on a prefix. Text
# written inside a parameter expansion (a default, alternate or replacement:
# `${n:-alias}`, `${HOME:+alias}`, `${x/*/alias}`) is literal, so the word is
# judged both with and without it, and such text holding a blank, which bash
# splits into words, is a `split` violation in a guarded position (the
# twenty-sixth round). A word whose spelling needs a variable VALUE or a
# command OUTPUT (`al${x}as` with x=i, `al$(echo i)as`), `eval`, a `source`
# of a file written by the suite, and `declare -n` (a variable, not a
# function) remain outside this gate (the Honest bound of the Sweep section in
# docs/guides/npm-audit-gate-hardening.md). So does a write to the suite
# counter by any route: the freeze protects the binding, not the counter it
# writes, so a plain `FAILED=0`, an arithmetic reset, or a trap action that
# runs one (`set -o functrace` with a RETURN trap that assigns `FAILED=0`,
# round thirty) is for review to catch. The trap rule below covers only a
# trap whose action exits or execs.
#
# posix mode turns expand_aliases on as a side effect, so entering it is the
# same violation (the twenty-fourth board round; checked in bash 5.2, where
# `set -o posix` alone makes `shopt -p expand_aliases` print `-s`): a `set`
# statement with an o flag cluster before a later `posix` word (`set -o
# posix`, `set -eo posix`, until a `--` or `-` ends its options), a `shopt`
# statement with an s flag cluster before `posix` (`shopt -s -o posix`), and
# any word that names POSIXLY_CORRECT, since assigning it enters posix mode
# from every position bash allows (`POSIXLY_CORRECT=1`, `export`, `declare`,
# `printf -v`, `read`, `${POSIXLY_CORRECT:=1}`, even as a prefix of `:`, and
# as an array or inside any array literal: twenty-fifth round).
#
# A DEBUG trap under `shopt -s extdebug` is the other binding-independent
# neuter: bash skips the NEXT command whenever a command run by the DEBUG
# trap returns non-zero, so `trap '[[ $BASH_COMMAND != fail\ * ]]' DEBUG`
# makes every `fail "..."` call vanish with the function still frozen (the
# seventh board round). The words `trap ... DEBUG` (any case; bash accepts
# `debug`) and `shopt -s extdebug` in command position are reported, with
# the `debug` status: a self-defense suite has no use for either. A trap on EXIT, ERR,
# RETURN or 0 (any numeric spelling of 0: bash reads a signal number as a
# signed decimal between blanks, so 00, +0, -0, ' 00' and '0 ' are all 0,
# the twenty-first to twenty-third rounds; see sig_word) whose action exits or execs
# overrides the exit status the script
# itself chose — `trap 'exit 0' EXIT` turns a suite that reached `exit 1`
# with FAILED=1 into a green one (the ninth board round) — so such an
# action is reported too, including an action that names a function this
# file defines whose body exits or execs, directly or through another
# function of the file (`cleanup() { exit 0; }` + `trap cleanup EXIT`, the
# tenth round). EVERY word of such an action is read as a possible call,
# since its command words cannot be found reliably in the action text
# (thirty-seventh round), so a function that exits named only as an
# argument is reported too. A trap on a real signal (`trap 'exit 143' TERM`) and a
# cleanup trap whose functions never exit (`trap 'rm -rf "$TMP"' EXIT`)
# are fine. A function defined in a sourced file is outside the scan.
#
# A function named after a bash BUILTIN shadows that builtin for the rest
# of the script, at any nesting depth once the enclosing code runs: a
# `readonly() { return 0; }` makes every later `readonly -f` a no-op, an
# `exit() { return 0; }` or a `test() { :; }` makes the final verdict a
# no-op, and `enable -n readonly` switches the builtin off outright (the
# eighth board round). The set of names is DERIVED from the running bash
# (`compgen -b`), never listed by hand, and a definition of any of them —
# `name()`, `name ( )` or `function name`, in any position — or an `enable`
# command word is reported with the `builtin` status.
#
# Definitions nested in something are out of scope: inside a function body
# (it runs on every call, so it cannot be frozen on its first run without
# breaking its second), a loop (the same), a subshell (it does not outlive
# it), or an `if`/`case` arm (a conditional helper; the gate does not follow
# which arm ran). A BARE brace group `{ ...; }` is not one of them: it runs
# its contents once and unconditionally, as top level does, so a definition
# inside it is judged as at top level (thirty-third board round: nesting was
# counted alike for every compound, and a helper defined in a bare group was
# never derived and never had to be frozen). The lexer tracks that nesting
# by command word — `if`/`fi`, `case`/`esac`, `do`/`done`, `{`/`}` — not by
# indentation, and records what opened each level, so a brace that opens a
# function body hides its contents and a bare one does not.
# A reserved word counts only where bash would read one: unquoted, in command
# position. A case pattern (the words before each `)` that follows `in`,
# `;;`, `;&` or `;;&`) is text, and so is a quoted `"{"` (the twelfth board
# round found a `"}"` pattern closing the count early and a `"{"` pattern
# leaving it one level high for the rest of the file, which hid every later
# top-level definition from the `shape` rule). The `in` may sit on a later
# line than `case WORD`, a pattern may open with its optional `(`, and an
# extglob group inside it (`@(a|b)`, `!(x)`) has parentheses of its own that
# do not end the pattern (thirteenth round: each of those ended or skipped
# the pattern state and left the count one level high).
# Every definition at true top level must be where the freeze rule can see it:
# at column 0, at the start of its own line, with a plain identifier for a
# name. One anywhere else at top level — indented with nothing enclosing it,
# after another command or a closing brace on the line, a second definition
# on one line (even with the same name as the first), or a
# name bash accepts but the rule does not (a dash, a dot) — is reported with
# the `shape` status instead of being skipped (the eleventh board round found
# ` fail() { :; }`, indented by one space with nothing enclosing it, invisible
# and unfrozen).
#
# The derivation is the single implementation of "what does this file define":
# `--list` prints it as TSV so the sweep tool and the tests read the same
# answer the gate acts on (lessons-learned #18: derive the subject, never
# restate it).
#
# Exit codes: 0 every definition frozen; 1 at least one violation; 2 tooling,
# vacuity or parse error (no files, nothing derived from them — a gate that
# scans nothing is not a passing gate, lesson #9 — or a file the lexer cannot
# carry to EOF, reported at the line the unclosed heredoc, quote,
# substitution, arithmetic, subshell or array literal opened on).
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
#   <file> \t <name> \t <def line> \t <end line> \t frozen|unfrozen|stray|alias|debug|trap|builtin|shape|unsupported|brace|split|multiline|close|subscript|parse-error
# Only column-0 lines that start OUTSIDE a quoted region count: the program
# lexes single quotes, double quotes, $'...' strings, backslash escapes,
# `$(`/`(` contexts (a `$(` inside double quotes opens a fresh quoting
# context, as bash does) and comments, and it skips heredoc bodies. That is
# what keeps an awk program written as `NAME='...function flush() {...'`, or
# a fixture written from a heredoc, from reading as a bash definition — the
# sweep that introduced this gate broke a suite by freezing exactly such a
# line inside a quoted awk program.
# The bash builtins, derived from the interpreter that runs the gate. A gate
# that compares against an empty set would report nothing, so an empty
# derivation is an error, not a pass.
BUILTINS="$(compgen -b | tr '\n' ' ')"
if [ -z "$BUILTINS" ]; then
  echo "::error::check-fn-freeze: compgen -b returned no builtins — the builtin-shadowing rule would be vacuous" >&2
  exit 2
fi
readonly BUILTINS

derive_file() {
  awk -v file="$2" -v builtins=" $BUILTINS " '
    # An assignment word, as bash recognises one before the command name:
    # NAME=, NAME+=, and a subscripted NAME[...]= or NAME[...]+= (bash runs
    # the command after each, even when it refuses the subscript). Only
    # NAME= was recognised until the thirty-fifth board round, so in
    # X+=2 alias fail=: the word X+=2 was read as the command word and the
    # alias went unreported. A subscript is not parsed: bash reads it to its
    # closing bracket with quotes, escapes and nesting of its own, and each
    # attempt to follow that here was one spelling short (thirty-sixth round:
    # a[b[2]]=1; thirty-seventh: a["x]"]=1, whose quote is gone from the
    # word). A word that starts NAME[ and holds a ] followed by = or += is
    # taken as an assignment, which can only over-report (it would take a
    # command named that way for a prefix). A subscript holding a blank is
    # split into several words and is reported instead (subscript, below).
    # One function, called by every site that skips an assignment word.
    function is_assign(s) {
      if (s ~ /^[A-Za-z_][A-Za-z0-9_]*\+?=/) return 1
      return s ~ /^[A-Za-z_][A-Za-z0-9_]*\[/ && s ~ /\]\+?=/
    }
    # The word before a redirection operator is its file descriptor, not a
    # word of the statement, when it is unquoted digits or {NAME} (2>, {fd}>).
    function fd_prefix() {
      return !wq && (w ~ /^[0-9]+$/ || w ~ /^\{[A-Za-z_][A-Za-z0-9_]*\}$/)
    }
    # Every row is one TSV line. A label built from source text (a trap
    # action, a word decoded from an ANSI-C string) can hold a tab or a
    # newline, which would shift the columns or split the row, and the
    # report would count a violation it cannot print (forty-first board
    # round). Both, and a carriage return, become ?.
    function emit(label, first, last, status) {
      gsub(/[\t\n\r]/, "?", label)
      printf "%s\t%s\t%d\t%d\t%s\n", file, label, first, last, status
    }
    # What the substitution stack entry k was opened by, for a parse error.
    function open_kind(k) {
      if (st_dbl[k] == 3) return "backtick span `"
      if (st_dbl[k] == 2) return "$[ ] arithmetic"
      if (st_dbl[k] == 1) return st_dol[k] ? "$(( )) arithmetic" : "(( )) arithmetic"
      return st_dol[k] ? "$( ), <( ) or >( ) substitution" : "( ) subshell"
    }
    function flush_def() {
      pending_name = def_name; pending_def = def_line; pending_end = NR
      def_name = ""
      bs = def_bs
    }
    # The group of the open definition closed in command position: the
    # definition ends HERE, mid-line, so the rest of its line is lexed as top
    # level (thirty-sixth board round: ending it only once the whole line was
    # lexed left a definition after the brace on that line, as in
    # `  }; bar() { :; }`, neither derived nor reported). closed_name and
    # closed_line keep what was closed for the close report.
    # closed_col0: the line the group closed on starts with its brace at
    # column 0, the one place a multi-line body may close.
    function close_def() {
      closed_name = def_name; closed_line = def_line; grp_closed = 1
      closed_col0 = (lex_text ~ /^\}/)
      flush_def()
    }
    # Advance the lexer over one line, updating the quote state (q), the
    # context stack (d, st_q[]) and the heredoc queue (hd_n, hd_term[]).
    # The scan also TOKENISES executable text into words the way bash does
    # before it looks a command up: quotes of every kind are removed and the
    # pieces joined (al"ias", the word in single or $ quotes), a backslash
    # escapes the next character
    # (`\a\l\i\a\s`), and whitespace or a control operator ends the word. The
    # alias rule is then a check on the WORDS of a statement: the COMMAND
    # word is the first word that is not an assignment (`X="1"`, `X+=1`,
    # `a[0]=1`: see is_assign) and not one
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
    # Any expansion may produce nothing (`$()` always does, `$(true)`,
    # `${x:+Q}` and an unset `$1` do at run time), so a word is also judged
    # with every expansion in it removed: `ali$()as`, `ali${x:+Q}as`,
    # `expand$(true)_aliases`, `-$()s` and `DEBU$1G` are the guarded words to
    # bash (fifteenth and sixteenth board rounds). wk is that form, made by
    # no_exp; it is used for command names and arguments, never for reserved
    # words, which bash recognises before any expansion. Text written inside
    # a parameter expansion is judged as well (see pexp); only a value or an
    # output that must CONTRIBUTE text to spell the word stays outside.
    # The lexer leaves a `$( )` as the placeholder `$()` and keeps `${...}`,
    # backticks and `$NAME` as written, so no_exp removes all four forms; a
    # trap action is raw text, so there the whole `$(...)` goes, a comment
    # inside it included.
    function no_exp(s,   p) {
      do {
        p = s
        gsub(/\$\([^()]*\)/, "", s); gsub(/\$\{[^{}]*\}/, "", s); gsub(/`[^`]*`/, "", s)
      } while (s != p)
      gsub(/\$[A-Za-z_][A-Za-z0-9_]*/, "", s); gsub(/\$[0-9@*#?$!-]/, "", s)
      return s
    }
    # A parameter expansion can contribute text written inside it: a default
    # (:- - := =), an alternate (:+ +) or a replacement (/pat/TEXT) yields
    # either nothing or that literal TEXT, depending on state the scan cannot
    # see (twenty-sixth board round: shopt -s ${n:-expand_aliases} and
    # ${HOME:+alias} both bind). pexp rewrites each such group as the brace
    # alternation {,TEXT}, so brace_exp judges the word both ways, with the
    # same cap; any other group yields only a value the scan cannot see, and
    # becomes empty as no_exp would make it. Nested groups are rewritten from
    # the inside out. The TEXT is judged after quote and backslash removal.
    # An unquoted expansion is also split into fields at blanks, so TEXT that
    # holds a blank can spell a whole statement (${x:-alias fail=:} runs
    # alias); that reshapes the statement, which no word rule can place, so
    # pexp sets px_split and end_word reports it in a guarded position.
    # lit is set for the TEXT of an operand: a brace or comma there is a
    # literal character of the value, never brace syntax (bash does not
    # brace-expand an expansion result), and no guarded word holds one, so it
    # becomes ? rather than reshaping the alternation it is placed in.
    function pexp(s, lit,   out, i, n, j, ch) {
      out = ""; n = length(s); i = 1
      while (i <= n) {
        ch = substr(s, i, 1)
        if (lit && ch == "\\") { ch = substr(s, i + 1, 1); if (ch == "{" || ch == "}" || ch == ",") ch = "?"; out = out ch; i += 2; continue }
        if (substr(s, i, 2) != "${") { if (lit && (ch == "{" || ch == "}" || ch == ",")) ch = "?"; out = out ch; i++; continue }
        j = brace_close(s, i + 2, n)
        out = out pexp_group(substr(s, i + 2, j - i - 3))
        i = j
      }
      return out
    }
    # The index just past the brace that closes a group whose body starts at
    # j. Braces inside a single-quoted, ANSI-C or double-quoted string, or
    # after a backslash, are text to bash (twenty-seventh board round:
    # ${x:-"}"} closed one brace early, and the stray quote then swallowed a
    # real statement), so they are not counted.
    # The index just past the paren closing a command substitution whose
    # body starts at j, skipping quoted text, escapes and nested ones.
    function paren_close(s, j, n,   pd, qs, cj) {
      pd = 1; qs = ""
      # The same quote model as brace_close below: an ANSI-C string is its
      # own state, entered on a dollar and a quote and read after the
      # backslash skip, so an escaped quote inside it ends nothing
      # (twenty-ninth board round); a nested substitution is its own unit.
      while (j <= n && pd > 0) {
        cj = substr(s, j, 1)
        if (qs == "s") { if (cj == "\047") qs = ""; j++; continue }
        if (cj == "\\") { j += 2; continue }
        if (qs == "a") { if (cj == "\047") qs = ""; j++; continue }
        if (cj == "$" && substr(s, j + 1, 1) == "(") { j = paren_close(s, j + 2, n); continue }
        if (cj == "`") { j = tick_close(s, j + 1, n); continue }
        if (qs == "d") { if (cj == "\"") qs = ""; j++; continue }
        if (cj == "$" && substr(s, j + 1, 1) == "\047") { qs = "a"; j += 2; continue }
        if (cj == "\047") qs = "s"
        else if (cj == "\"") qs = "d"
        else if (cj == "(") pd++
        else if (cj == ")") pd--
        j++
      }
      return j
    }
    # The index just past the backtick closing one opened before j.
    function tick_close(s, j, n,   cj) {
      while (j <= n) {
        cj = substr(s, j, 1)
        if (cj == "\\") { j += 2; continue }
        if (cj == "`") return j + 1
        j++
      }
      return j
    }
    function brace_close(s, j, n,   bd, qs, cj) {
      bd = 1; qs = ""
      while (j <= n && bd > 0) {
        cj = substr(s, j, 1)
        if (qs == "s") { if (cj == "\047") qs = ""; j++; continue }
        if (cj == "\\") { j += 2; continue }
        if (qs == "a") { if (cj == "\047") qs = ""; j++; continue }
        # A command substitution is its own balanced unit, quoted or not, as
        # bash reads it: a brace inside $( ) or backticks ends nothing here
        # (twenty-eighth board round).
        if (cj == "$" && substr(s, j + 1, 1) == "(") { j = paren_close(s, j + 2, n); continue }
        if (cj == "`") { j = tick_close(s, j + 1, n); continue }
        if (qs == "d") { if (cj == "\"") qs = ""; j++; continue }
        if (cj == "$" && substr(s, j + 1, 1) == "\047") { qs = "a"; j += 2; continue }
        if (cj == "\047") qs = "s"
        else if (cj == "\"") qs = "d"
        else if (cj == "{") bd++
        else if (cj == "}") bd--
        j++
      }
      bc_open = (bd > 0)
      return j
    }
    # The TEXT of a default, alternate or replacement starts right after the
    # last character of its operator: - = or + for a default or alternate,
    # a slash for a replacement. Rather than parse the name, a subscript and
    # the operator (a nested ${...} in a subscript may hold a bracket, the
    # twenty-eighth board round; a pattern may hold an escaped or quoted
    # slash, the twenty-seventh), every suffix of the group after one of
    # those characters is a candidate: a superset that holds the true TEXT
    # whatever precedes it. Each is normalised alone, so the commas joining
    # them stay alternation.
    function pexp_group(b,   t, c, k, n, ch) {
      t = ""; n = length(b)
      for (k = 1; k <= n; k++) {
        ch = substr(b, k, 1)
        if (ch == "-" || ch == "=" || ch == "+" || ch == "/") {
          c = pexp_text(substr(b, k + 1))
          if (c != "") t = (t == "" ? c : t "," c)
        }
      }
      if (t == "") return ""
      return "{," t "}"
    }
    # One operand TEXT as the words it can yield: blanks noted for the split
    # rule, nested groups rewritten, then quotes and backslashes removed.
    function pexp_text(t) {
      if (t ~ /[ \t\n]/) px_split = 1
      t = pexp(t, 1)
      gsub(/["\047\\]/, "", t)
      return t
    }
    # Brace expansion is static: bash expands `al{i,}as` to `alias alas` and
    # `{a..a}lias` to `alias` before any command is looked up (eighteenth
    # board round). brace_exp fills bx[1..nbx] with every word a word can
    # expand to (capped at 64, nesting at 8); a word with no brace group is
    # its own only candidate. has(t) is true when any candidate equals t and
    # anym(re) when any matches re. Checking every candidate, not only the
    # first, is deliberately conservative: a guarded word anywhere in the
    # expansion is reported. The caps bound the work, not the verdict: when
    # an expansion has more words than the cap, or nests deeper, bx_trunc
    # is set, and end_word reports a truncated word in a guarded position
    # as `brace` instead of judging the prefix it saw (nineteenth board
    # round: a guarded word at position 65 was silently passed).
    function brace_exp(s) { delete bx; nbx = 0; bx_trunc = 0; bexp(s, 0); return nbx }
    function bexp(s, depth,   n, i, j, c, lvl, en, comma, body, pre, post, parts, np, k, lo, hi, st, al, v) {
      n = length(s)
      if (nbx >= 64) { bx_trunc = 1; return }
      if (depth > 8 && index(s, "{")) bx_trunc = 1
      if (depth <= 8) for (i = 1; i <= n; i++) {
        if (substr(s, i, 1) != "{") continue
        lvl = 0; comma = 0; en = 0
        for (j = i; j <= n; j++) {
          c = substr(s, j, 1)
          if (c == "{") lvl++
          else if (c == "}") { lvl--; if (lvl == 0) { en = j; break } }
          else if (c == "," && lvl == 1) comma = 1
        }
        if (!en) break
        body = substr(s, i + 1, en - i - 1); pre = substr(s, 1, i - 1); post = substr(s, en + 1)
        if (comma) {
          np = 0; lvl = 0; st = 1
          for (j = 1; j <= length(body); j++) {
            c = substr(body, j, 1)
            if (c == "{") lvl++
            else if (c == "}") lvl--
            else if (c == "," && lvl == 0) { parts[++np] = substr(body, st, j - st); st = j + 1 }
          }
          parts[++np] = substr(body, st)
          for (k = 1; k <= np; k++) bexp(pre parts[k] post, depth + 1)
          return
        }
        if (body ~ /^-?[0-9]+\.\.-?[0-9]+(\.\.-?[0-9]+)?$/) {
          split(body, parts, /\.\./); lo = parts[1] + 0; hi = parts[2] + 0
          st = (parts[3] == "" || parts[3] + 0 == 0) ? 1 : parts[3] + 0; if (st < 0) st = -st
          if (lo <= hi) { for (v = lo; v <= hi; v += st) { if (nbx >= 64) { bx_trunc = 1; break }; bexp(pre v post, depth + 1) } }
          else { for (v = lo; v >= hi; v -= st) { if (nbx >= 64) { bx_trunc = 1; break }; bexp(pre v post, depth + 1) } }
          return
        }
        if (body ~ /^[A-Za-z]\.\.[A-Za-z](\.\.-?[0-9]+)?$/) {
          al = "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz"
          split(body, parts, /\.\./); lo = index(al, parts[1]); hi = index(al, parts[2])
          st = (parts[3] == "" || parts[3] + 0 == 0) ? 1 : parts[3] + 0; if (st < 0) st = -st
          if (lo <= hi) { for (v = lo; v <= hi; v += st) { if (nbx >= 64) { bx_trunc = 1; break }; bexp(pre substr(al, v, 1) post, depth + 1) } }
          else { for (v = lo; v >= hi; v -= st) { if (nbx >= 64) { bx_trunc = 1; break }; bexp(pre substr(al, v, 1) post, depth + 1) } }
          return
        }
      }
      bx[++nbx] = s
    }
    # bash parses a trap signal number with its legal_number(): any whitespace
    # before it (space, tab, newline, vertical tab, form feed, carriage
    # return), an optional sign, decimal digits, then trailing blanks. Linux
    # bash 5.2 takes only a space or tab after the digits (checked for every
    # class, twenty-third board round), but the Git for Windows bash on the
    # Windows CI runner also takes a newline there: an exit trap on a zero
    # followed by a newline (spelled with ANSI-C quoting) replaced the exit
    # status in job 107713633065. The gate has to hold on
    # every bash the suites run under, so it reads any whitespace after the
    # digits as a blank too, a superset of both. A name
    # is matched as written, case aside, so only a number is normalised,
    # and the regex alone decides which blanks and signs a number may carry
    # (the digit run is then taken whole, so no second strip can widen it); a
    # blank inside any other word makes it a name bash rejects, so it is
    # replaced and can never read as a separate signal in trap_sigs.
    function sig_word(s) {
      s = toupper(s)
      if (s ~ /^[ \t\n\v\f\r]*[-+]?[0-9]+[ \t\n\v\f\r]*$/) {
        match(s, /[0-9]+/); s = substr(s, RSTART, RLENGTH)
        sub(/^0+/, "", s); if (s == "") s = "0"
      } else gsub(/[ \t\n\v\f\r]/, "_", s)
      return s
    }
    function has(t,   k) { for (k = 1; k <= nbx; k++) if (bx[k] == t) return 1; return 0 }
    function anym(re,   k) { for (k = 1; k <= nbx; k++) if (bx[k] ~ re) return 1; return 0 }
    function end_word(   rq, wk, k) {
      # rq: a quote or a backslash went into this word, so it is never a
      # reserved word (bash recognises those before quote removal).
      rq = wq; wq = 0
      if (w == "") return
      # The word after a redirection operator is its target: never the
      # command word, never an argument (thirty-eighth board round).
      if (redir) { redir = 0; w = ""; return }
      px_split = 0; wk = no_exp(pexp(w)); brace_exp(wk)
      # A case pattern is text. Only an unquoted `esac` where a pattern would
      # start ends the case (after the last `;;`).
      if (pat) {
        if (!rq && w == "esac" && pat_n == 0) {
          if (bs > 0) bs--
          # Like fi and done below, esac ends a compound command, and what
          # follows it is in command position (a closing brace included).
          pat = 0; cmd_seen = 0; cmd_word = ""; nwords = 0
        } else pat_n++
        w = ""; return
      }
      # Assigning POSIXLY_CORRECT enters posix mode, which turns
      # expand_aliases on (twenty-fourth board round), and bash lets it be
      # assigned from any position (a prefix, export, declare, read, printf
      # -v, a default expansion), so any word naming it is a violation. The
      # word is judged as written (a default expansion is removed by no_exp)
      # and as every word it expands to.
      if (w ~ /(^|[^A-Za-z0-9_])POSIXLY_CORRECT([^A-Za-z0-9_]|$)/ || anym("(^|[^A-Za-z0-9_])POSIXLY_CORRECT([^A-Za-z0-9_]|$)"))
        emit(w, NR, NR, "alias")
      # A word whose brace expansion was cut short is judged as a guarded
      # word would be only on the words it produced; where the missing ones
      # could be guarded (a command name, or any word of an alias, shopt,
      # set or trap statement) that is not a verdict, so it is a violation. An
      # assignment word before the command name is not brace-expanded by
      # bash at all, so its value is never judged.
      if (bx_trunc && (!cmd_seen || in_alias || in_shopt || in_trap || in_set) && !(!cmd_seen && is_assign(w)))
        emit(w, NR, NR, "brace")
      # The same positions, for a parameter expansion whose TEXT bash splits
      # into fields (see pexp); a trap action is text, judged by check_trap.
      if (px_split && (!cmd_seen || in_alias || in_shopt || in_trap || in_set) && !(!cmd_seen && is_assign(w)) && !(in_trap && !trap_has_action && w !~ /^-/))
        emit(w, NR, NR, "split")
      if (!cmd_seen) {
        # `case WORD` ended its line without `in`: the first word of a later
        # line is that `in` (only blank and comment lines may come between).
        if (case_wait) {
          case_wait = 0
          if (!rq && w == "in") { pat = 1; pat_n = 0; w = ""; return }
        }
        # Still looking for the command word of this statement.
        # Compound-command nesting, counted by command word so that layout
        # cannot fake it: `if`, `do` and `{` open, `fi`, `done` and `}` close
        # (`case`/`esac` are handled below as ordinary command words). Each
        # level records what opened it (bk): a function body (f), a bare
        # brace group (b) or a conditional or repeated compound (c). A bare
        # group runs once, unconditionally, so a definition inside one is
        # judged as at top level (thirty-third board round); fn_body says the
        # next brace opens the body of a definition just seen (2 while that
        # definition name word is still to be consumed).
        was_fn = (fn_body == 1); fn_body = (fn_body == 2) ? 1 : 0
        if (!rq && (w == "if" || w == "do")) { bs++; bk[bs] = "c" }
        if (!rq && w == "{") { bs++; bk[bs] = was_fn ? "f" : "b" }
        if (!rq && (w == "}") && bs > 0) {
          bs--
          # The brace group of the open definition closed here, in command
          # position, as bash reads it (see the definition rule): on its own
          # line, on the line its brace opened on, or on a later body line.
          if (def_name != "" && d == 0 && bs == def_bs) close_def()
        }
        if ((!rq && w ~ /^(!|if|then|elif|else|do|while|until|coproc|\{|\})$/) ||
            w ~ /^(builtin|command|time|-p)$/ ||
            is_assign(w)) { w = ""; return }
        if (!rq && w == "case") { bs++; bk[bs] = "c" }
        # fi, done and esac end a compound command, and the word after one is
        # in command position again: in h() { if true; then :; fi } the brace
        # after fi closes h, as bash reads it (thirty-third board round: the
        # brace was read as an argument, h stayed open and swallowed every
        # definition up to the next column-0 brace).
        if (!rq && (w == "fi" || w == "done" || w == "esac")) { if (bs > 0) bs--; w = ""; return }
        cmd_seen = 1; cmd_word = w; nwords = 1
        # Inside a definition, remember what the body runs: an exit or exec
        # marks the function as one that ends the shell, anything else is a
        # call the trap rule may have to follow (see resolve_traps).
        if (def_name != "") {
          if (has("exit") || has("exec")) fexits[def_name] = 1
          else for (k = 1; k <= nbx; k++) if (bx[k] != def_name) fcalls[def_name] = fcalls[def_name] " " bx[k]
        }
        if (has("alias")) in_alias = 1
        if (has("shopt")) in_shopt = 1
        if (has("set")) in_set = 1
        if (has("trap")) in_trap = 1
        if (!rq && w == "function") in_function = 1
        if (has("enable")) emit("enable", NR, NR, "builtin")
        w = ""; return
      }
      nwords++
      # A statement whose command word starts NAME[ but is not an assignment
      # is a subscripted prefix split at a blank (a[1 + 1]=5 alias fail=:):
      # bash reads the subscript to its closing bracket, blanks included, and
      # runs what follows as the command, which the gate cannot place, so it
      # is reported (thirty-seventh board round).
      if (nwords == 2 && cmd_word ~ /^[A-Za-z_][A-Za-z0-9_]*\[/)
        emit(cmd_word, NR, NR, "subscript")
      # `case WORD in`: what follows is a pattern, up to its `)`.
      if (cmd_word == "case" && nwords == 2) case_wait = 1
      # (`pat_d` needs no reset where a pattern opens: a pattern ends only at
      # depth zero, and `case_wait` needs none here: the first word of the next
      # statement consumes it; the fourteenth round found both unobservable.)
      if (cmd_word == "case" && nwords == 3 && !rq && w == "in") { pat = 1; pat_n = 0 }
      # The word after `function` is a definition name whatever follows it.
      if (in_function) {
        if (index(builtins, " " w " ") > 0) emit("function " w, NR, NR, "builtin")
        shape_check("function " w, w)
        # The body group follows the name, so what comes next is a command
        # word again, as after `name()`: its brace counts toward the nesting,
        # which is what closes a one-line definition (thirty-second round).
        in_function = 0; cmd_seen = 0; cmd_word = ""; nwords = 0; fn_body = 1
      }
      if (in_alias && anym("^[A-Za-z_][A-Za-z0-9_]*="))
        emit("alias " w, NR, NR, "alias")
      if (in_shopt && sflag != "" && has("expand_aliases"))
        emit("shopt " sflag " " w, NR, NR, "alias")
      # posix mode turns expand_aliases on too (twenty-fourth board round):
      # set with an o flag cluster before posix, or shopt -s -o posix.
      if (in_set && oflag != "" && has("posix"))
        emit("set " oflag " " w, NR, NR, "alias")
      if (in_shopt && sflag != "" && has("posix"))
        emit("shopt " sflag " " w, NR, NR, "alias")
      if (in_shopt && sflag != "" && has("extdebug"))
        emit("shopt " sflag " " w, NR, NR, "debug")
      if (in_trap && anym("^[Dd][Ee][Bb][Uu][Gg]$"))
        emit("trap ... " w, NR, NR, "debug")
      # The first non-flag argument of trap is its action; every later word
      # is a signal. The pair is judged when the statement ends. bash reads
      # a numeric signal as an optionally signed decimal between blanks, so
      # 00, +0, -0 and a zero with a quoted blank on either side are all
      # signal 0 (twenty-first to twenty-third board rounds); sig_word
      # stores each as its value. A negative non-zero signal is rejected by bash, so
      # dropping the sign cannot turn a real signal into 0.
      if (in_trap) {
        if (!trap_has_action) { if (w !~ /^-/) { trap_action = w; trap_has_action = 1 } }
        else for (k = 1; k <= nbx; k++) if (bx[k] != "") trap_sigs = trap_sigs " " sig_word(bx[k])
      }
      if (in_shopt && anym("^-[a-z]*s[a-z]*$")) sflag = w
      # set takes options until -- or a lone -, after which every word is a
      # positional parameter, so posix there sets nothing.
      if (in_set && !set_end) { if (has("--") || has("-")) set_end = 1; else if (anym("^-[A-Za-z]*o[A-Za-z]*$")) oflag = w }
      w = ""
    }
    # An EXIT, ERR or RETURN trap (or 0, the EXIT alias) whose action holds
    # the word exit or exec, after the backslashes bash would drop, replaces
    # the exit status the script chose.
    # The action is judged as every text its parameter expansions can leave
    # (see pexp), each with the other expansions removed. An action with more
    # alternatives than brace_exp enumerates is already a brace violation:
    # the action is a word of a trap statement (see end_word).
    function check_trap(   a, a0, na, ka, acand, cws) {
      a0 = trap_action; gsub(/\\/, "", a0)
      na = brace_exp(no_exp(pexp(a0)))
      for (ka = 1; ka <= na; ka++) { acand[ka] = bx[ka]; gsub(/"/, "", acand[ka]); gsub(sprintf("%c", 39), "", acand[ka]) }
      for (ka = 1; ka <= na; ka++) {
        a = acand[ka]
        if (a ~ /(^|[^A-Za-z0-9_])(exit|exec)([^A-Za-z0-9_]|$)/ && trap_sigs ~ /(^| )(EXIT|ERR|RETURN|0)( |$)/) {
          emit("trap " a " ..." trap_sigs, NR, NR, "trap")
          break
        }
        if (trap_sigs ~ /(^| )(EXIT|ERR|RETURN|0)( |$)/) {
          # EVERY word of the action is a function the trap may call. Its
          # command words cannot be found reliably in the action text: the
          # quotes are gone, and a prefix assignment may hold a subscript with
          # blanks (thirty-seventh board round: a[1 + 1]=5 cleanup hid the
          # call). A word that is only an argument costs nothing unless it
          # names a function of this file that exits. A redirection ends a
          # word here as in the lexer (thirty-eighth round: cleanup>/dev/null
          # was one word that named nothing). Which of them this file
          # defines is only known at END, since a trap is often set before
          # its handler is written.
          ns = split(a, segs, /[;&|<>[:space:]]+/)
          for (k = 1; k <= ns; k++) {
            cw = segs[k]
            if (cw != "" && index(cws, " " cw " ") == 0) { cws = cws " " cw " "; nt++; t_word[nt] = cw; t_line[nt] = NR; t_sigs[nt] = trap_sigs }
          }
        }
      }
      trap_action = ""; trap_sigs = ""; trap_has_action = 0
    }
    # Whether function f, as defined in this file, can end the shell: its
    # own body runs exit or exec, or it calls another function of this file
    # that can. `seen` stops recursion on a cycle (case 19k-d holds one);
    # without it a call cycle recurses forever, so a regression there shows
    # up as a hung job rather than a red case. A function does not record
    # a call to itself (the definition line names it as a word), so only a
    # real cycle between two functions can reach that path.
    function fn_exits(f,   cs, nc, j) {
      if (f in fexits) return 1
      nc = split(fcalls[f], cs, " ")
      for (j = 1; j <= nc; j++)
        if ((cs[j] in defined) && !(cs[j] in seen)) { seen[cs[j]] = 1; if (fn_exits(cs[j])) return 1 }
      return 0
    }
    function resolve_traps(   k) {
      for (k = 1; k <= nt; k++) {
        delete seen; seen[t_word[k]] = 1
        if (fn_exits(t_word[k]))
          emit("trap " t_word[k] " ..." t_sigs[k] " (names " t_word[k] "(), which exits)", t_line[k], t_line[k], "trap")
      }
    }
    # A definition the lexer found at the start of a statement is in scope when
    # it is outside every function body (def_name empty, or the line that
    # defines def_name itself), every subshell (d == 0) and every compound
    # command (bs back at the depth it had outside any definition). If the
    # column-0 rule did not derive it on this line, the freeze rule cannot see
    # it, so it is reported rather than left unfrozen and unmentioned.
    # The column-0 rule derives exactly one definition per line, the first one
    # on it, so only the first statement-start occurrence of that name is
    # excused. A second definition of the same name later on the line is a
    # redefinition the freeze on the next line would protect instead (twelfth
    # board round: `fail() { ...; }; fail() { :; }` was reported frozen).
    # Nesting levels above the definition context that are not bare brace
    # groups: a bare group runs its contents once, so it hides nothing.
    function cond_depth(   k, c) {
      c = 0
      for (k = def_bs + 1; k <= bs; k++) if (bk[k] != "b") c++
      return c
    }
    function shape_check(label, n) {
      if (n == line_def && !line_def_hit) { line_def_hit = 1; return }
      if (d == 0 && cond_depth() == 0 && (def_name == "" || def_name == line_def))
        emit(label, NR, NR, "shape")
    }
    # Every statement starts with no trap state of its own; a trap inside a
    # substitution must not read the enclosing trap action as its own.
    function end_command() { end_word(); if (in_trap) check_trap(); redir = 0; cmd_seen = 0; cmd_word = ""; nwords = 0; in_alias = 0; in_shopt = 0; in_trap = 0; in_function = 0; sflag = ""; in_set = 0; oflag = ""; set_end = 0; trap_action = ""; trap_sigs = ""; trap_has_action = 0 }
    # Entering `$( ... )` or `( ... )` starts a new context: the enclosing
    # quote state and the enclosing array-literal state are both pushed and
    # both cleared, and the matching `)` restores them. Array-literal skipping
    # must be cleared here, not only quoting: `arr=($(alias fail=:))` stores
    # the OUTPUT of a command that runs, so its text is code (the sixth board
    # round found a single global array flag swallowing it as literal words).
    # `(( ... ))`, `$(( ... ))` and the deprecated `$[ ... ]` open an
    # ARITHMETIC context, where `<<`, `<<=` and `>>` are shift operators,
    # never a heredoc (the eighth board round found `if (( 1 << 2 == 4 ))`
    # swallowing the rest of the file as a heredoc body; the ninth found the
    # same through `$[1 << 2]`). A plain `(` nested inside one inherits the
    # context; a context opened by `((` closes on `))` (dbl = 1) and one
    # opened by `$[` closes on `]` (dbl = 2). Inside a double-quoted string
    # or an array literal a `$((` must still open the context, because the
    # `$(` rule would otherwise open a command context in which `<<` is a
    # heredoc (cases 27 and 27c); a `$[` there needs no opener, because the
    # string and array branches consume every character and never reach the
    # heredoc rule (the tenth board round found two such openers that no
    # fixture could tell apart from their absence, and removed them).
    # A `$( )`, `$(( ))` or `$[ ]` (dol = 1) is part of a word, so the
    # statement around it resumes when it closes: its command word, word
    # count and alias/shopt/trap state are pushed with the context and
    # restored, and the substitution counts as a word part (fourteenth board
    # round: `case "$(cmd)" in` lost the statement, so the `in` never opened
    # the pattern state). A pending `case ... in` and the pattern counters
    # need no push: neither can be set while a substitution is open in a
    # valid file. A statement inside the substitution starts with no trap
    # state of its own (end_command resets it). A bare `( )` or `(( ))` is a
    # compound command, and the `()` of a function definition relies on the
    # statement being reset, so those keep the old behaviour.
    function open_sub(saved_q, new_arith, dbl, dol) {
      # A substitution is part of the word it sits in (`$(a)$(b)` is one
      # word), so the pending word is carried across it, not ended here.
      if (dol) { d++; st_w[d] = w; w = ""; wq = 0 }
      else { end_word(); d++ }
      st_q[d] = saved_q; st_arr[d] = arr; st_arrd[d] = arr_d; st_at[d] = arr_txt; st_an[d] = arr_nm; st_al[d] = arr_line; st_arith[d] = arith; st_dbl[d] = dbl
      st_pat[d] = pat; st_dol[d] = dol
      # Where this opener stands, and where the quote it interrupts opened,
      # for a parse error at end of file.
      st_ln[d] = NR; st_ql[d] = q_line
      st_cs[d] = cmd_seen; st_cw[d] = cmd_word; st_nw[d] = nwords
      st_ia[d] = in_alias; st_ish[d] = in_shopt; st_it[d] = in_trap; st_sf[d] = sflag
      st_is[d] = in_set; st_of[d] = oflag; st_se[d] = set_end
      st_ta[d] = trap_action; st_ts[d] = trap_sigs; st_th[d] = trap_has_action
      # A redirection target may hold a substitution (>$(cmd)): the command
      # inside is lexed as one, and the target is dropped when it ends.
      st_rd[d] = redir
      # A trap statement is judged once, when it really ends, not here too.
      if (dol) in_trap = 0
      end_command()
      q = ""; arr = 0; arr_d = 0; arith = new_arith; pat = 0
    }
    function close_sub() {
      end_command()
      if (d > 0) {
        q = st_q[d]; arr = st_arr[d]; arr_d = st_arrd[d]; arr_txt = st_at[d]; arr_nm = st_an[d]; arr_line = st_al[d]; arith = st_arith[d]
        pat = st_pat[d]; q_line = st_ql[d]
        if (st_dol[d]) {
          cmd_seen = st_cs[d]; cmd_word = st_cw[d]; nwords = st_nw[d]
          in_alias = st_ia[d]; in_shopt = st_ish[d]; in_trap = st_it[d]; sflag = st_sf[d]
          in_set = st_is[d]; oflag = st_of[d]; set_end = st_se[d]
          trap_action = st_ta[d]; trap_sigs = st_ts[d]; trap_has_action = st_th[d]
          redir = st_rd[d]
          w = st_w[d] "$()"; wq = 1
        }
        d--
      }
    }
    # Decodes the ANSI-C escape at line[i] (a backslash) as bash does inside
    # an ANSI-C quoted string: named letters, octal (up to three digits), `\xHH`, `\uHHHH`,
    # `\UHHHHHHHH` and `\cX`. It returns the decoded text, sets ac_len to the
    # characters consumed and ac_nul when the value is NUL. A code point past
    # ASCII becomes `?`: no guarded word contains one. An escape bash does
    # not know keeps its backslash, as bash keeps it. Portable awk only (no
    # strtonum): CI may run mawk.
    function hexv(ch) { return index("0123456789abcdef", tolower(ch)) - 1 }
    function ansi_c(line, i,   nx, k, v, lim, ch) {
      nx = substr(line, i + 1, 1); ac_nul = 0; ac_len = 2
      if (nx == "") { ac_len = 1; return "\\" }
      k = index("abeEfnrtv", nx)
      if (k) return ansi_named(nx)
      if (nx == "\\" || nx == "\047" || nx == "\"" || nx == "?") return nx
      if (nx ~ /[0-7]/) {
        v = 0; k = 1
        while (k <= 3 && substr(line, i + k, 1) ~ /[0-7]/) { v = v * 8 + substr(line, i + k, 1); k++ }
        ac_len = k; return ansi_code(v % 256)
      }
      if (nx == "x" || nx == "u" || nx == "U") {
        lim = (nx == "x") ? 2 : (nx == "u") ? 4 : 8
        v = 0; k = 2
        while (k <= lim + 1 && hexv(substr(line, i + k, 1)) >= 0 && substr(line, i + k, 1) != "") { v = v * 16 + hexv(substr(line, i + k, 1)); k++ }
        if (k == 2) return "\\" nx
        ac_len = k; return ansi_code(v)
      }
      # The control escape is toupper(operand) AND 31 for any operand, so a
      # space and a backtick are NUL exactly as @ is, and a doubled backslash
      # operand is consumed whole (eighteenth board round, checked against
      # bash 5.2). With no operand left on this line the operand is the
      # newline that ends it, and the result is that newline.
      if (nx == "c") {
        ch = substr(line, i + 2, 1)
        if (ch == "") return sprintf("%c", 10)
        ac_len = 3
        if (ch == "\\" && substr(line, i + 3, 1) == "\\") ac_len = 4
        if (ch == "?") return ansi_code(127)
        v = index(" !\"#$%&\047()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~", toupper(ch))
        if (v == 0) return "?"
        return ansi_code((v + 31) % 32)
      }
      return "\\" nx
    }
    function ansi_named(nx) {
      if (nx == "a") return ansi_code(7); if (nx == "b") return ansi_code(8)
      if (nx == "e" || nx == "E") return ansi_code(27); if (nx == "f") return ansi_code(12)
      if (nx == "n") return ansi_code(10); if (nx == "r") return ansi_code(13)
      if (nx == "t") return ansi_code(9); return ansi_code(11)
    }
    function ansi_code(v) {
      if (v == 0) { ac_nul = 1; return "" }
      if (v >= 128) return "?"
      return sprintf("%c", v)
    }
    function lex_line(line,   n, i, c, c2, c3, rest, tok, carry, j, bd, cj, dc) {
      n = length(line); i = 1
      # A trailing unquoted backslash joins this line to the next one, so the
      # word and the two words before it carry over (`alias \` + `fail=:`,
      # or `al\` + `ias`, are one statement to bash).
      carry = cont; cont = 0
      lex_text = line
      if (q == "" && !carry) { cmd_seen = 0; cmd_word = ""; nwords = 0; in_alias = 0; in_shopt = 0; in_trap = 0; in_function = 0; sflag = ""; in_set = 0; oflag = ""; set_end = 0; w = ""; wq = 0; trap_action = ""; trap_sigs = ""; trap_has_action = 0 }
      # Where the code of this line ends: at its trailing comment, or at the
      # end of the line. The definition rules read the body of a definition
      # line off this ONE lexer, so a comment inside any quote kind or inside
      # a `$( )` nested in a double-quoted string is text to both (the eighth
      # board round found a second, narrower scanner disagreeing with this
      # one on exactly that, and a helper after the disagreement was lost).
      code_end = n + 1
      while (i <= n) {
        c = substr(line, i, 1); c2 = substr(line, i, 2); c3 = substr(line, i, 3)
        if (q == "s") { if (c == "\047") q = ""; else w = w c; i++; continue }
        # Inside an ANSI-C quoted string bash decodes each escape before the
        # word is looked up, so the octal escape 141 followed by lias IS the
        # word alias; ansi_c decodes the same forms (seventeenth board round).
        # A NUL ends the value of the string: bash drops everything after it
        # up to the closing quote, so a_nul discards those characters.
        if (q == "a") {
          if (c == "\\") { dc = ansi_c(line, i); if (!a_nul) { if (ac_nul) a_nul = 1; else w = w dc }; i += ac_len; continue }
          if (c == "\047") { q = ""; a_nul = 0 } else if (!a_nul) w = w c
          i++; continue
        }
        if (q == "d") {
          # Inside double quotes a backslash escapes only a dollar, a backtick,
          # a double quote, a backslash or the newline; before anything else
          # bash keeps it, so "al\ias" runs al\ias, not alias (thirty-second
          # board round). A trap action is unescaped again where it is judged.
          if (c == "\\") {
            dq_nc = substr(line, i + 1, 1)
            if (dq_nc == "" || dq_nc == "$" || dq_nc == "`" || dq_nc == "\"" || dq_nc == "\\") w = w dq_nc
            else w = w c dq_nc
            i += 2; continue
          }
          if (c == "\"") { q = ""; i++; continue }
          if (c3 == "$((") { open_sub(q, 1, 1, 1); i += 3; continue }
          if (c2 == "$(") { open_sub(q, 0, 0, 1); i += 2; continue }
          if (c == "`") { open_sub(q, 0, 3, 1); i++; continue }
          if (c == "$" && match(substr(line, i + 1), /^([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/)) { w = w "${" substr(line, i + 1, RLENGTH) "}"; i += 1 + RLENGTH; continue }
          w = w c; i++; continue
        }
        if (arr) {
          if (c == "\\") { i += 2; continue }
          if (c2 == "$\047") { q = "a"; q_line = NR; i += 2; continue }
          if (c == "\047") { q = "s"; q_line = NR; i++; continue }
          if (c == "\"") { q = "d"; q_line = NR; i++; continue }
          if (c3 == "$((") { open_sub("", 1, 1, 1); i += 3; continue }
          if (c2 == "$(") { open_sub("", 0, 0, 1); i += 2; continue }
          if (c == "`") { open_sub("", 0, 3, 1); i++; continue }
          if (c == "(") arr_d++
          if (c == ")") {
            arr_d--
            if (arr_d == 0) {
              # An element can assign the posix-mode variable (a default
              # expansion, an arithmetic subscript), so the literal text and
              # its quoted parts (collected in w) are judged for the name.
              # The two are collected apart, so the report names the array
              # as written (NAME=(...)) rather than rebuilding its text, on
              # the line where it opens, where that name is written.
              if (arr_txt ~ /(^|[^A-Za-z0-9_])POSIXLY_CORRECT([^A-Za-z0-9_]|$)/ || w ~ /(^|[^A-Za-z0-9_])POSIXLY_CORRECT([^A-Za-z0-9_]|$)/)
                emit(arr_nm "(...)", arr_line, arr_line, "alias")
              arr = 0; w = ""
            }
          }
          arr_txt = arr_txt c
          i++; continue
        }
        if (c == "\\") {
          if (i == n) { cont = 1; i++; continue }
          w = w substr(line, i + 1, 1); wq = 1; i += 2; continue
        }
        if (c2 == "$\047") { q = "a"; q_line = NR; wq = 1; i += 2; continue }
        # A dollar-double-quoted string is a locale-translated string; with no
        # translation catalog, and in every self-defense suite, it is its own
        # text, so it opens the same state as a plain double quote (eighteenth
        # board round: the dollar was kept, so the word read as a variable).
        if (c2 == "$\"") { q = "d"; q_line = NR; wq = 1; i += 2; continue }
        if (c == "\047") { q = "s"; q_line = NR; wq = 1; i++; continue }
        if (c == "\"") { q = "d"; q_line = NR; wq = 1; i++; continue }
        # A `${...}` is one part of the current word up to its matching brace,
        # so `ali${x:+ Q}as` is one word, as it is to bash (sixteenth round).
        if (c2 == "${") {
          j = brace_close(line, i + 2, n)
          # A group is read one line at a time. One whose closing brace is on
          # a later line (bash allows it) would have its text judged cut
          # short, and the rest lexed as a new statement, so it is refused
          # outright rather than guessed at (thirtieth board round).
          if (bc_open) emit(substr(line, i), NR, NR, "multiline")
          w = w substr(line, i, j - i); i = j; continue
        }
        # A `$NAME` is kept as `${NAME}`, so the name still ends where bash
        # ends it after quote removal joins the word: `ali$x"as"` is `alias`
        # when x is empty, and must not read as the variable `xas`.
        if (c == "$" && match(substr(line, i + 1), /^([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/)) { w = w "${" substr(line, i + 1, RLENGTH) "}"; i += 1 + RLENGTH; continue }
        if (c == "#") {
          if (i == 1 || substr(line, i - 1, 1) ~ /[[:space:];(&|]/) { end_word(); code_end = i; break }
          w = w c; i++; continue
        }
        # In a case pattern, `(` and `|` separate words and `)` ends it, so
        # none of them opens a subshell or ends a statement. The word before
        # them is ended first: if it was `esac`, the case is over and the
        # character is ordinary again.
        # A `(` that opens the pattern is its optional leading paren; any
        # other `(` opens an extglob group, whose `)` closes the group, not
        # the pattern.
        if (pat && c == "(") {
          if (!(w == "" && pat_n == 0)) pat_d++
          i++; continue
        }
        if (pat && c == ")" && pat_d > 0) { pat_d--; i++; continue }
        if (pat && (c == ")" || c == "|")) {
          end_word()
          if (pat) {
            if (c == ")") { pat = 0; end_command() }
            i++; continue
          }
        }
        if (c3 == "$((") { open_sub("", 1, 1, 1); i += 3; continue }
        if (c2 == "$[") { open_sub("", 1, 2, 1); i += 2; continue }
        if (c2 == "$(") { open_sub("", 0, 0, 1); i += 2; continue }
        if (c == "]" && d > 0 && st_dbl[d] == 2) { close_sub(); i++; continue }
        # A backtick span is a command substitution like $( ) (dbl 3): the
        # statement around it is saved and resumes when the matching
        # backtick closes it (fortieth board round: read as word text, a ;
        # inside it ended the enclosing statement, so in
        # alias `true;true` fail=: the alias word was never judged).
        if (c == "`" && d > 0 && st_dbl[d] == 3) { close_sub(); i++; continue }
        if (c == "`") { open_sub("", 0, 3, 1); i++; continue }
        # `NAME=(` / `NAME+=(` opens an ARRAY LITERAL: its elements are words
        # that are stored, never run, so none of them can be a command word.
        # The group is skipped to its closing paren (quotes inside it are
        # still tracked so a `)` in a string does not end it early), except
        # that a `$( )` inside it is a command that runs and is lexed as one.
        # `WORD(` or `WORD (` followed by `)` at the start of a statement is
        # a function definition of WORD (the only word so far), at whatever
        # depth; one named after a builtin is reported (see the header).
        if (c == "(" && substr(line, i) ~ /^\([[:space:]]*\)/) {
          dn = ""
          if (!cmd_seen && w != "") dn = w
          else if (cmd_seen && w == "" && nwords == 1) dn = cmd_word
          if (dn != "" && index(builtins, " " dn " ") > 0) emit(dn "()", NR, NR, "builtin")
          if (dn != "" && dn !~ /[=$]/) shape_check(dn "()", dn)
          # The next brace opens this definition body; if the name word is
          # still pending here, consuming it must not use up the mark.
          if (dn != "") fn_body = (w != "") ? 2 : 1
        }
        # Assigning an array to the posix-mode variable enters posix mode as
        # a scalar does (twenty-fifth board round), so the name is judged
        # here, where the word is consumed without reaching end_word.
        if (c == "(" && w ~ /^[A-Za-z_][A-Za-z0-9_]*\+?=$/) {
          if (w ~ /^POSIXLY_CORRECT\+?=$/) emit(w "(", NR, NR, "alias")
          arr = 1; arr_d = 1; arr_txt = ""; arr_nm = w; arr_line = NR; w = ""; i++; continue
        }
        if (c2 == "((" && w == "") { open_sub("", 1, 1, 0); i += 2; continue }
        if (c == "(") { open_sub("", arith, 0, 0); i++; continue }
        if (c == ")") {
          if (d > 0 && st_dbl[d] && c2 == "))") { close_sub(); i += 2; continue }
          close_sub(); i++; continue
        }
        if (c3 == "<<<") { if (fd_prefix()) w = ""; end_word(); i += 3; redir = 1; continue }
        if (c2 == "<<" && !arith) {
          if (fd_prefix()) w = ""
          end_word()
          rest = substr(line, i + 2)
          strip = (substr(rest, 1, 1) == "-")
          sub(/^-?[[:space:]]*/, "", rest)
          # The delimiter is any WORD (POSIX io_here: DLESS here_end), not an
          # identifier: `<<1EOF`, `<<-ZEOF`, `<<.EOF` are honoured by bash. An
          # identifier-only match left such a body lexed as code, and a decoy
          # `name() {` inside it swallowed every later definition (seventh
          # board round; the same bug the npm-audit suite fixed in its round 30).
          if (match(rest, /^(\047[^\047]+\047|"[^"]+"|(\\.|[^[:space:];&|<>()\047"\\])+)/)) {
            tok = substr(rest, RSTART, RLENGTH)
            gsub(/[\047"\\]/, "", tok)
            hd_n++; hd_term[hd_n] = tok; hd_strip[hd_n] = strip
            # Every heredoc queued before the bodies start is on this line.
            if (hd_n == 1) hd_line = NR
            i += 2 + (length(line) - i - 1 - length(rest)) + RLENGTH
            continue
          }
          i += 2; continue
        }
        # `;;`, `;&` and `;;&` end an arm, so a pattern follows (a trailing
        # `&` then ends an empty statement, which changes nothing).
        if (c2 == ";;" || c2 == ";&") { end_command(); pat = 1; pat_n = 0; i += 2; continue }
        # A redirection: its fd prefix (2>, {fd}>) is not a word, and the
        # word after the operator is its target, never the command word
        # (thirty-eighth board round: in >/tmp/x alias fail=: the target was
        # read as the command word, a here-string did the same, and >&2
        # ended the statement at its &). A doubled operator (>>, <>, &>>) is
        # read as two, which drops the same target. A process substitution,
        # <( or >(, is not a redirection: like $( ) it is part of the word it
        # sits in (echo<(true) is one word to bash), and the statement around
        # it resumes when it closes (thirty-ninth board round: opened as a
        # plain subshell, it ended the statement, so in alias <(true) fail=:
        # the alias words after it were never judged).
        if ((c == "<" || c == ">") && substr(line, i + 1, 1) == "(") { open_sub("", 0, 0, 1); i += 2; continue }
        if (c == "<" || c == ">" || c2 == "&>") {
          if (fd_prefix()) w = ""
          end_word()
          match(substr(line, i), /^(&>|<&|>&|>\||<|>)/)
          i += RLENGTH; redir = 1; continue
        }
        if (c ~ /[;&|]/) { end_command(); i++; continue }
        if (c ~ /[[:space:]<>]/) { end_word(); i++; continue }
        w = w c; i++
      }
      if (q == "" && !cont) { end_word(); if (in_trap) check_trap() }
    }
    {
      line = $0; line_def = ""; line_def_hit = 0

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
      # a quoted region, outside an open `$( )` / `( )` context and outside
      # an array literal; otherwise the line is string, subshell or literal
      # content. A column-0 `name() {` inside a multi-line `( ... )` defines a
      # subshell-local function that no freeze in the enclosing script can
      # reach (seventh board round: it was reported as an unfrozen top-level
      # helper, the same false positive the indentation rule already avoids).
      if (q != "" || d > 0 || arr) {
        if (line ~ /^readonly -f [A-Za-z_][A-Za-z0-9_]*[[:space:]]*$/) {
          n2 = line; sub(/^readonly -f /, "", n2); sub(/[[:space:]]*$/, "", n2)
          emit(n2, NR, NR, "stray")
        }
        lex_line(line)
        next
      }

      # Resolve a deferred definition: the line right after its closing brace.
      if (pending_name != "") {
        if (line ~ ("^readonly -f " pending_name "[[:space:]]*$")) {
          emit(pending_name, pending_def, pending_end, "frozen")
          pending_name = ""
          next
        }
        emit(pending_name, pending_def, pending_end, "unfrozen")
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
          # Closed on this line when the lexer saw the group brace close in
          # command position, as on the definition line (thirty-fifth board
          # round: the old test, a code part ending in a brace, missed a
          # group followed by more code and closed one ending in an argument).
          # The close itself ends the definition (close_def), so nothing is
          # left to do here once the line is lexed.
          lex_line(line)
          next
        }
        emit(def_name, def_line, NR, "unsupported")
        brace_pending = 0; def_name = ""
      }

      # Inside a multi-line definition, the lexer alone decides where it
      # ends: where the brace of its group closes in command position, as
      # bash reads it (close_def). What follows that brace on the same line
      # runs at top level and is lexed as such (the twelfth board round hid
      # `alias fail=:` after `};` there). A close anywhere but a `}` at
      # column 0 is a close violation, since the freeze rule ties a
      # multi-line definition to the line after that brace (thirty-fifth
      # round). A column-0 brace that closes only a group nested in the body
      # no longer ends the definition (thirty-sixth round: it did, and the
      # rest of the body, a redefinition included, was read as top level).
      # grp_closed needs no reset here: it is cleared where every definition
      # opens, and a close always ends the definition, so it is set after
      # this lex only when the group closed on this line.
      if (def_name != "") {
        lex_line(line)
        if (grp_closed && !closed_col0)
          emit(closed_name, closed_line, NR, "close")
        next
      }

      if (line ~ /^[[:space:]]*#/) next

      # A top-level definition opener, column 0 only: `name()`, `function
      # name()` or `function name`, with the optional bash whitespace inside the
      # parens (`fail ( ) {` is a real, freezable function — the fifth board
      # round found the adjacent-only pattern left such a helper invisible).
      # What follows the opener on the line decides the body: nothing (after
      # the comment is removed) means the brace group opens on a later line;
      # `{` means it opens here, and it closes here when the lexer saw its
      # closing brace in command position on this line (grp_closed), whatever
      # code follows it; anything else is a body this derivation does not
      # follow, reported. A brace that is only an argument (`echo }`) closes
      # nothing, to bash or here, and a one-liner followed by more code
      # (`f() { :; }; true`) still ends on its own line (thirty-second board
      # round: the old test, a code part ending in a brace, left both open
      # until a later column-0 brace and swallowed every definition between).
      name = ""; rest = ""
      if (match(line, /^(function[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\([[:space:]]*\)/)) {
        name = substr(line, RSTART, RLENGTH); rest = substr(line, RLENGTH + 1)
        sub(/^function[[:space:]]+/, "", name); sub(/[[:space:]]*\([[:space:]]*\)$/, "", name)
      } else if (match(line, /^function[[:space:]]+[A-Za-z_][A-Za-z0-9_]*/)) {
        name = substr(line, RSTART, RLENGTH); rest = substr(line, RLENGTH + 1)
        sub(/^function[[:space:]]+/, "", name)
      }
      if (name != "") {
        opener = length(line) - length(rest)
        # The name is recorded before the line is lexed, so the commands of a
        # one-line body are attributed to it (the trap rule reads them).
        def_name = name; def_line = NR; defined[name] = 1; line_def = name; def_bs = bs
        grp_closed = 0
        lex_line(line)
        body = (code_end > opener + 1) ? substr(line, opener + 1, code_end - opener - 1) : ""
        sub(/^[[:space:]]+/, "", body); sub(/[[:space:]]+$/, "", body)
        if (body == "") { brace_pending = 1; next }
        if (body ~ /^\{/) next
        emit(name, NR, NR, "unsupported")
        def_name = ""
        next
      }

      # A freeze that is not the resolution of a pending definition is a stray.
      if (match(line, /^readonly -f [A-Za-z_][A-Za-z0-9_]*[[:space:]]*$/)) {
        n2 = line; sub(/^readonly -f /, "", n2); sub(/[[:space:]]*$/, "", n2)
        emit(n2, NR, NR, "stray")
        next
      }

      lex_line(line)
    }
    END {
      resolve_traps()
      if (pending_name != "")
        emit(pending_name, pending_def, pending_end, "unfrozen")
      if (def_name != "" && brace_pending)
        emit(def_name, def_line, NR, "unsupported")
      else if (def_name != "")
        emit(def_name, def_line, 0, "close")
      # A lexer that ends the file inside a heredoc or a quoted string has
      # skipped everything after the opener; that is a parse failure, not a
      # clean file, and the gate must not report the skipped tail as frozen.
      # Each row names the line the construct OPENED on, which is where the
      # reader has to go; the last line of the file says nothing about it
      # (forty-second board round).
      if (hd_n > 0)
        emit("unterminated heredoc <<" hd_term[1], hd_line, NR, "parse-error")
      else if (q != "")
        emit("unterminated quoted string", q_line, NR, "parse-error")
      # So is one that ends inside a substitution, a subshell, an arithmetic
      # context or an array literal: everything after the opener was lexed
      # as its contents, so a definition there was never judged (forty-first
      # board round: an unclosed backtick span, or $( ), passed with exit 0).
      else if (d > 0)
        emit("unterminated " open_kind(1), st_ln[1], NR, "parse-error")
      else if (arr)
        emit("unterminated array literal (", arr_line, NR, "parse-error")
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
    echo "  - $file:$line: $what opened here is still open at end of file" >&2
  done <<<"$parse_errors"
  exit 2
fi

# The vacuity guard counts every derived row: a file whose only definition
# is malformed (a `shape`, `stray` or `unsupported` row) must get that
# violation's report, not "nothing derived" (fourteenth board round).
total="$(grep -cE $'\t(frozen|unfrozen)$' <<<"$rows" || true)"
derived="$(grep -c . <<<"$rows" || true)"
if [ "${derived:-0}" -eq 0 ]; then
  echo "::error::check-fn-freeze: ${#files[@]} file(s) scanned and no function definition derived — either the derivation broke or the suites define nothing (fail closed)" >&2
  exit 2
fi

violations="$(grep -E $'\t(unfrozen|stray|alias|debug|trap|builtin|shape|unsupported|brace|split|multiline|close|subscript)$' <<<"$rows" || true)"
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
        stray)    echo "  - $file:$def: 'readonly -f $name' does not directly follow a top-level definition of $name() — a freeze before the definition cannot bind, a freeze with a window after it leaves that window open, a freeze inside a quoted string or fixture is text, not a statement, and a freeze naming a function this file never defines is left over from a rename or a deletion: move this line to directly after the closing brace of $name(), or delete it" ;;
        alias)    echo "  - $file:$def: '$name' — 'readonly -f' freezes the function binding, not the name: once expand_aliases is on an alias takes every later call of a frozen helper, so a self-defense suite may not define an alias or enable alias expansion (shopt -s expand_aliases, or posix mode: set -o posix, shopt -s -o posix, or any use of POSIXLY_CORRECT) — delete this line" ;;
        # A DEBUG trap and extdebug have no action to change, so their line is
        # the fix; they carry their own status (fortieth board round: routing
        # on the label text sent an EXIT action that began with three dots to
        # this message).
        debug)    echo "  - $file:$def: '$name' — a DEBUG trap under extdebug makes bash skip the next command, so every call of a frozen helper can be made to vanish without touching its binding; a self-defense suite may not set a DEBUG trap (in any spelling of the signal) or enable extdebug — delete the whole trap or shopt statement this line belongs to, including any lines it continues from (a backslash or an open quote carries a statement across lines)" ;;
        trap)     echo "  - $file:$def: '$name' — a trap on EXIT, ERR, RETURN or 0 (or any numeric spelling of 0, such as 00, +0, -0 or a quoted '0 ') whose action exits or execs, directly or through a function of this file it may call, can replace the exit status the script chose, so a self-defense suite may not exit from a trap on EXIT, ERR, RETURN or 0 (a trap on a real signal such as INT or TERM may) — make its action return without exiting, or delete the trap; every word of such an action is read as a possible call, so when a function that exits is named in it only as an argument, leave that name out of the action" ;;
        builtin)  echo "  - $file:$def: '$name' — a function named after a bash builtin shadows it for the rest of the script (a readonly that returns 0 makes every later freeze a no-op; an exit or a test that returns 0 makes the final verdict a no-op), and enable can switch a builtin off outright, so a self-defense suite may not define a function named after a builtin (compgen -b) or call enable — rename this function, or delete the enable call" ;;
        shape)    echo "  - $file:$def: '$name' — a top-level function defined anywhere but column 0 at the start of its own line (indented, after another command or a closing brace, second on a line) or with a name that is not a plain identifier is invisible to the freeze rule, so one inserted redefinition could take it unnoticed — define it at column 0 on its own line with a plain name, then freeze it on the next line" ;;
        brace)    echo "  - $file:$def: '$name' — this brace expansion produces more words than the gate enumerates (64, nested 8 deep), in a command name or an alias, shopt, set or trap statement, so a guarded word could sit past the cut where the gate cannot see it — list the words it needs explicitly, or split the statement" ;;
        split)    echo "  - $file:$def: '$name' — this parameter expansion's default, alternate or replacement text holds a blank, and bash splits an unquoted expansion into separate words there, so in a command name or an alias, shopt, set or trap statement it can spell a guarded command the gate cannot place — write the words out literally" ;;
        multiline) echo "  - $file:$def: '$name' — this \${...} group does not close on the line it opens on; the gate reads a group one line at a time, so text written in it on a later line (a default, alternate or replacement that can spell a guarded word) would go unjudged — put the whole group on one line" ;;
        subscript) echo "  - $file:$def: '$name' — this statement starts with a subscripted name holding a blank; bash reads a subscript to its closing bracket, blanks included, so what follows it may be the command (a[1 + 1]=5 alias fail=: defines an alias), and the gate cannot place it — write the subscript without blanks (a[1+1]=5); the gate then judges what follows it as the command, so a guarded command there (the alias in this example) is still reported and has to go too" ;;
        close)
          if [ "$end" -gt 0 ]; then
            echo "  - $file:$def: $name() closes on line $end, but not with a '}' at column 0 — the gate ties a multi-line definition to its freeze by a column-0 closing brace, so it cannot tell where $name() ends; move that brace to column 0 and put 'readonly -f $name' on the line after it"
          else
            echo "  - $file:$def: $name() opens a brace group that never closes before the end of the file — close it with a '}' at column 0 and put 'readonly -f $name' on the line after it"
          fi ;;
        unsupported) echo "  - $file:$def: $name() has a body this gate cannot follow (not a brace group opened on the definition line or the next) — write it as a one-liner '$name() { ...; }', or multi-line with the closing '}' at column 0, then freeze it on the next line" ;;
      esac
    done <<<"$violations"
  } >&2
  exit 1
fi

echo "check-fn-freeze: $total function(s) across ${#files[@]} file(s) are frozen with readonly -f directly after their definition"
exit 0
