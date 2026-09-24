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
# exactly `readonly -f name`. A one-line definition closes on its own line; a
# multi-line definition closes at the first later line that starts with `}` at
# column 0. Any other `readonly -f X` line is a stray: it either names a
# function this file never defines, or sits somewhere other than directly after
# X's definition (a pre-declaration, or a freeze with a window before it).
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
#   <file> \t <name> \t <def line> \t <end line> \t frozen|unfrozen|stray
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
    # Advance the lexer over one line, updating the quote state (q), the
    # context stack (d, st_q[]) and the heredoc queue (hd_n, hd_term[]).
    function lex_line(line,   n, i, c, c2, c3, rest, tok) {
      n = length(line); i = 1
      while (i <= n) {
        c = substr(line, i, 1); c2 = substr(line, i, 2); c3 = substr(line, i, 3)
        if (q == "s") { if (c == "\047") q = ""; i++; continue }
        if (q == "a") { if (c == "\\") { i += 2; continue } if (c == "\047") q = ""; i++; continue }
        if (q == "d") {
          if (c == "\\") { i += 2; continue }
          if (c == "\"") { q = ""; i++; continue }
          if (c2 == "$(") { d++; st_q[d] = q; q = ""; i += 2; continue }
          i++; continue
        }
        if (c == "\\") { i += 2; continue }
        if (c2 == "$\047") { q = "a"; i += 2; continue }
        if (c == "\047") { q = "s"; i++; continue }
        if (c == "\"") { q = "d"; i++; continue }
        if (c == "#") {
          if (i == 1 || substr(line, i - 1, 1) ~ /[[:space:];(&|]/) break
          i++; continue
        }
        if (c2 == "$(") { d++; st_q[d] = ""; i += 2; continue }
        if (c == "(") { d++; st_q[d] = ""; i++; continue }
        if (c == ")") { if (d > 0) { q = st_q[d]; d-- } i++; continue }
        if (c3 == "<<<") { i += 3; continue }
        if (c2 == "<<") {
          rest = substr(line, i + 2)
          sub(/^-?[[:space:]]*/, "", rest)
          if (match(rest, /^(\047[A-Za-z_][A-Za-z0-9_]*\047|"[A-Za-z_][A-Za-z0-9_]*"|\\?[A-Za-z_][A-Za-z0-9_]*)/)) {
            tok = substr(rest, RSTART, RLENGTH)
            gsub(/[\047"\\]/, "", tok)
            hd_n++; hd_term[hd_n] = tok
            i += 2 + (length(line) - i - 1 - length(rest)) + RLENGTH
            continue
          }
          i += 2; continue
        }
        i++
      }
    }
    {
      line = $0

      # Inside a heredoc body: only its terminator matters.
      if (hd_n > 0) {
        t = line; sub(/^\t+/, "", t)
        if (t == hd_term[1]) {
          for (k = 1; k < hd_n; k++) hd_term[k] = hd_term[k + 1]
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

      # Inside a multi-line definition: the column-0 closing brace ends it.
      if (def_name != "") {
        if (line ~ /^\}/) { flush_def(); next }
        lex_line(line)
        next
      }

      if (line ~ /^[[:space:]]*#/) next

      # A top-level definition. Three spellings, column 0 only.
      name = ""
      if (match(line, /^(function[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\(\)[[:space:]]*\{/)) {
        name = substr(line, RSTART, RLENGTH)
        sub(/^function[[:space:]]+/, "", name); sub(/[[:space:]]*\(\)[[:space:]]*\{$/, "", name)
      } else if (match(line, /^function[[:space:]]+[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\{/)) {
        name = substr(line, RSTART, RLENGTH)
        sub(/^function[[:space:]]+/, "", name); sub(/[[:space:]]*\{$/, "", name)
      }
      if (name != "") {
        trimmed = line; sub(/[[:space:]]+$/, "", trimmed)
        def_name = name; def_line = NR
        if (trimmed ~ /\}$/) flush_def()
        lex_line(line)
        next
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
      if (def_name != "")
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

violations="$(grep -E $'\t(unfrozen|stray)$' <<<"$rows" || true)"
if [ -n "$violations" ]; then
  count="$(grep -c '' <<<"$violations")"
  echo "::error::check-fn-freeze: $count violation(s) across ${#files[@]} file(s) ($total definition(s) derived). A function that is not frozen can be rebound by one inserted line, which silently neuters every assertion whose evidence passes through it:"
  while IFS=$'\t' read -r file name def end status; do
    [ -n "$file" ] || continue
    case "$status" in
      unfrozen) echo "  - $file:$def: $name() is not frozen — add 'readonly -f $name' on line $((end + 1)), directly after its closing brace" ;;
      stray)    echo "  - $file:$def: 'readonly -f $name' does not directly follow a top-level definition of $name() — a freeze before the definition cannot bind, a freeze with a window after it leaves that window open, and a freeze inside a quoted string or fixture is text, not a statement" ;;
    esac
  done <<<"$violations"
  exit 1
fi

echo "check-fn-freeze: $total function(s) across ${#files[@]} file(s) are frozen with readonly -f directly after their definition"
exit 0
