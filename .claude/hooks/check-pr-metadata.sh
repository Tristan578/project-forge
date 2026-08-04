#!/usr/bin/env bash
# PreToolUse hook: fires on `gh pr create` commands.
# Validates that the command includes --milestone and Closes #NNNN in the body.
# Exits 2 to BLOCK the command if metadata is missing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/hook-utils.sh"

COMMAND=$(get_bash_command)

# Only check gh pr create commands
if [[ "$COMMAND" != *"gh pr create"* ]]; then
  exit 0
fi

# Bypass for automated PRs (autoforge scripts use their own metadata)
if grep -qE 'autoforge:' <<<"$COMMAND"; then
  exit 0
fi

# Extract the path passed to --body-file / --body-file=<path> / -F <path>.
# Echoes the path and returns 0 when the flag is present with a value; returns
# 1 when the flag is absent (an inline --body, or no body at all). A flag with
# NO value returns 0 with an empty path so the caller can reject it rather than
# silently falling back to the command-string check.
#
# EVERY occurrence is scanned, not just the first, and the first one naming a
# readable file wins. This hook cannot parse shell quoting, so a --title that
# merely MENTIONS the flag looks identical to the flag itself — and that is not
# hypothetical: this hook's own PR was titled "read --body-file so the PR
# metadata check is satisfiable", and taking the first occurrence extracted the
# path 'so' from the title and blocked on it. Falling back to the first
# occurrence when nothing is readable keeps the fail-closed behavior intact.
#
# The path is only ever used as a quoted argument — never eval'd, never spliced
# into a composed command line — so a path containing shell metacharacters is
# inert here.
extract_body_file() {
  local cmd="$1" rest cand first_val="" found=0
  # Each pass consumes through the matched flag, so `cmd` strictly shrinks and
  # the loop always terminates.
  while [[ "$cmd" =~ (^|[[:space:]])(--body-file|-F)([=[:space:]]+|$) ]]; do
    rest="${cmd#*"${BASH_REMATCH[0]}"}"
    case "$rest" in
      \"*) cand="${rest#\"}"; cand="${cand%%\"*}" ;;
      \'*) cand="${rest#\'}"; cand="${cand%%\'*}" ;;
      *)   cand="${rest%%[[:space:]]*}" ;;
    esac
    if [ "$found" -eq 0 ]; then
      first_val="$cand"
      found=1
    fi
    if [ -n "$cand" ] && [ -f "$cand" ] && [ -r "$cand" ]; then
      printf '%s' "$cand"
      return 0
    fi
    cmd="$rest"
  done
  [ "$found" -eq 1 ] || return 1
  printf '%s' "$first_val"
}

ERRORS=()

# Where the body actually comes from decides what we inspect. gh sends the FILE
# when --body-file is present, so the file is the only honest place to look for
# the issue link — a `Closes #NNNN` sitting elsewhere in the command (in the
# --title, say) must not launder a body file that has no link.
#
# Reading the file is not optional politeness: block-main-commits.sh refuses to
# analyse a command over 4000 chars and directs large content to a file, so any
# substantive PR body MUST arrive this way. Grepping only the command string
# made the two hooks jointly unsatisfiable.
if BODY_FILE="$(extract_body_file "$COMMAND")"; then
  if [ -z "$BODY_FILE" ]; then
    ERRORS+=("--body-file was given with no path, so the PR body cannot be checked.")
  elif [ ! -f "$BODY_FILE" ] || [ ! -r "$BODY_FILE" ]; then
    # Fail closed: an unverifiable body is not a verified one.
    ERRORS+=("--body-file points at '$BODY_FILE', which is not a readable file — cannot verify 'Closes #NNNN'.")
  elif ! grep -qiE 'Closes #[0-9]+' -- "$BODY_FILE"; then
    ERRORS+=("PR body file '$BODY_FILE' must contain 'Closes #NNNN' linking to a GitHub issue.")
  fi
elif ! grep -qiE 'Closes #[0-9]+' <<<"$COMMAND"; then
  ERRORS+=("PR body must contain 'Closes #NNNN' linking to a GitHub issue.")
fi

# Check for --milestone flag
if ! grep -qE '\-\-milestone' <<<"$COMMAND"; then
  ERRORS+=("PR must specify --milestone (e.g. --milestone 'P1: User Workflow Blockers').")
fi

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  # Feedback must go to STDERR — the harness surfaces stderr on exit 2, so a
  # reason written to stdout reaches the caller as "No stderr output" and the
  # block arrives with no stated reason. Same convention as
  # block-main-commits.sh. Hit live on this hook's own PR.
  {
  echo "================================================================"
  echo "  PR METADATA CHECK — MISSING REQUIRED FIELDS"
  echo "================================================================"
  for err in "${ERRORS[@]}"; do
    echo "  - $err"
  done
  echo ""
  echo "  Available milestones (run: gh api repos/Tristan578/project-forge/milestones --jq '.[].title'):"
  echo "    P0: Production Blockers"
  echo "    P1: User Workflow Blockers"
  echo "    E1: Game Creation E2E"
  echo "    E2: Community & Viral Growth"
  echo "    E3: Instrumentation & Growth Metrics"
  echo "    E4: Onboarding & Activation"
  echo "    E5: AI Generation Quality"
  echo "    E6: Content Safety & Trust"
  echo "    S1: Quality & Reliability"
  echo "    S2: Accessibility & Compliance"
  echo "    S3: Performance & Scale"
  echo "    S4: SEO & GEO Foundation"
  echo "    Post-Launch Vision"
  echo "================================================================"
  } >&2
  exit 2
fi

exit 0
