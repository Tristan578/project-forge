#!/usr/bin/env bash
# check-symlinks.sh — every path git records as a symlink (mode 120000) must be
# a REAL symlink in this working tree, and must resolve to something git tracks
# inside the repository.
#
# Why: skills and references are shared by symlink so that each has exactly one
# source. A checkout with `core.symlinks=false` (the Git for Windows default)
# writes each link as a one-line text file holding its target path. Claude Code
# then loads none of those skills, and nothing reports it. A link whose target
# is missing, untracked, absolute, or outside the repository breaks the same way
# on a fresh clone.
#
# Exit: 0 all links good, 1 at least one problem, 2 not inside a git work tree.
# Runs in CI (portable-paths job) and at session start (on-session-start.sh).
set -uo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "check-symlinks: not inside a git work tree" >&2
  exit 2
}
cd "$root" || exit 2
real_root="$(pwd -P)"
command -v realpath >/dev/null 2>&1 || {
  echo "check-symlinks: realpath is required (coreutils; macOS 13+ ships it)" >&2
  exit 2
}

# disp <text> — text for display with every control byte (ESC, newline, ...)
# replaced by "?". Paths and link targets come from the repository, and this
# output reaches a terminal and the session-start hook, so a tracked path must
# not be able to drive either. Display only: the remedy commands below already
# quote with shq, which renders control bytes as $'\033'-style text.
# Quote one path as a shell word for a printed remedy command. A plain path goes
# through printf %q. A path holding a control or non-ASCII byte is written as
# $'...' with every such byte (and \\ and ') as a three-digit octal escape:
# bash 3.2's %q (macOS /bin/bash) can print control bytes raw, and an escape
# is the same bytes once the shell reads it back.
shq() {
  local LC_ALL=C s="$1" out="" c n i
  case "$s" in
    *[[:cntrl:]]*|*[$'\x80'-$'\xff']*) ;;
    *) printf '%q' "$s"; return ;;
  esac
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      [[:cntrl:]]|[$'\x80'-$'\xff']|\\|\') printf -v n '\\%03o' "'$c"; out="$out$n" ;;
      *) out="$out$c" ;;
    esac
  done
  printf "\$'%s'" "$out"
}

# Byte-wise (LC_ALL=C) so the result does not depend on the caller's locale:
# C0 controls and DEL via [[:cntrl:]], and C1 controls (U+0080-U+009F, which a
# UTF-8 terminal can act on, e.g. U+009B as CSI) by their exact UTF-8 encoding
# 0xC2 0x80-0x9F. Other multi-byte characters pass through untouched.
disp() {
  local LC_ALL=C t="$1"
  t="${t//$'\xc2'[$'\x80'-$'\x9f']/?}"
  printf '%s' "${t//[[:cntrl:]]/?}"
}

total=0
stubs=()
problems=()

while IFS= read -r -d '' rec; do
  mode="${rec%% *}"
  [ "$mode" = "120000" ] || continue
  path="${rec#*$'\t'}"
  total=$((total + 1))

  if [ ! -L "$path" ] && [ ! -e "$path" ]; then
    # Paths come from the repository and the remedy is text people paste, so
    # every path in a printed command goes through shq (never hand quoting).
    problems+=("$(disp "$path"): missing from the working tree (restore it: git checkout -- $(shq "$path"))")
    continue
  fi
  if [ ! -L "$path" ]; then
    stubs+=("$path")
    continue
  fi

  target="$(readlink "$path")"
  case "$target" in
    /*|[A-Za-z]:*) problems+=("$(disp "$path") -> $(disp "$target"): absolute target"); continue ;;
  esac
  if [ ! -e "$path" ]; then
    problems+=("$(disp "$path") -> $(disp "$target"): does not resolve")
    continue
  fi
  resolved="$(realpath "$path")"
  case "$resolved" in
    "$real_root"/*) ;;
    *) problems+=("$(disp "$path") -> $(disp "$target"): resolves outside the repository"); continue ;;
  esac
  rel="${resolved#"$real_root"/}"
  if ! git ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then
    problems+=("$(disp "$path") -> $(disp "$target"): target is not tracked by git, so it is missing from a fresh clone")
  fi
done < <(git ls-files -s -z)

if [ "$total" -eq 0 ]; then
  echo "check-symlinks: no symlinks are recorded in this repository."
  echo "This repository shares skills and references by symlink, so zero links means"
  echo "the check is looking at the wrong tree. If links were removed on purpose, remove this check too."
  exit 1
fi

if [ "${#stubs[@]}" -eq 0 ] && [ "${#problems[@]}" -eq 0 ]; then
  echo "check-symlinks: $total symlinks OK"
  exit 0
fi

if [ "${#stubs[@]}" -gt 0 ]; then
  echo "check-symlinks: ${#stubs[@]} of $total symlinks are checked out as plain text files:"
  for p in "${stubs[@]}"; do printf '  %s\n' "$(disp "$p")"; done
  echo ""
  echo "Skills behind these links do not load. Fix this clone once (in Git Bash on Windows):"
  echo "  git config core.symlinks true"
  echo "  (Windows: Settings > System > For developers > Developer Mode must be on.)"
  echo "Then re-create each link:"
  for p in "${stubs[@]}"; do
    q="$(shq "$p")"
    echo "  rm -f -- $q && git checkout -- $q"
  done
  echo ""
fi

if [ "${#problems[@]}" -gt 0 ]; then
  echo "check-symlinks: ${#problems[@]} broken symlinks:"
  printf '  %s\n' "${problems[@]}"
fi

exit 1
