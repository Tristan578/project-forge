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

total=0
stubs=()
problems=()

while IFS= read -r -d '' rec; do
  mode="${rec%% *}"
  [ "$mode" = "120000" ] || continue
  path="${rec#*$'\t'}"
  total=$((total + 1))

  if [ ! -L "$path" ] && [ ! -e "$path" ]; then
    problems+=("$path: missing from the working tree (restore it: git checkout -- '$path')")
    continue
  fi
  if [ ! -L "$path" ]; then
    stubs+=("$path")
    continue
  fi

  target="$(readlink "$path")"
  case "$target" in
    /*|[A-Za-z]:*) problems+=("$path -> $target: absolute target"); continue ;;
  esac
  if [ ! -e "$path" ]; then
    problems+=("$path -> $target: does not resolve")
    continue
  fi
  resolved="$(realpath "$path")"
  case "$resolved" in
    "$real_root"/*) ;;
    *) problems+=("$path -> $target: resolves outside the repository"); continue ;;
  esac
  rel="${resolved#"$real_root"/}"
  if ! git ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then
    problems+=("$path -> $target: target is not tracked by git, so it is missing from a fresh clone")
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
  printf '  %s\n' "${stubs[@]}"
  echo ""
  echo "Skills behind these links do not load. Fix this clone once (in Git Bash on Windows):"
  echo "  git config core.symlinks true"
  echo "  (Windows: Settings > System > For developers > Developer Mode must be on.)"
  echo "Then re-create each link:"
  for p in "${stubs[@]}"; do
    q="${p//\'/\'\\\'\'}"
    echo "  rm -f -- '$q' && git checkout -- '$q'"
  done
  echo ""
fi

if [ "${#problems[@]}" -gt 0 ]; then
  echo "check-symlinks: ${#problems[@]} broken symlinks:"
  printf '  %s\n' "${problems[@]}"
fi

exit 1
