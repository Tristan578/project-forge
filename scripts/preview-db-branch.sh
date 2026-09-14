#!/usr/bin/env bash
# Preview-database branch policy for the per-PR Vercel preview (#9972, #10015).
#
# WHY THIS EXISTS
# ---------------
# ci.yml gives every preview deploy its own copy-on-write Neon branch and
# migrates it before deploying, so a migration that cannot apply fails the PR
# instead of production (#9972). The project's branch allowance is FIXED (ten
# on the current plan) and it is shared: `production`, `staging`, the 14-day
# pre-migration snapshots cd.yml retains, and one branch per open PR with web
# changes. On 2026-09-14 the eleventh create was refused with
# BRANCHES_LIMIT_EXCEEDED and every preview deploy after it failed the same
# way, on every PR, until a branch was deleted by hand (#10015). All ten
# branches were legitimate at the time -- none belonged to a closed PR. The
# ceiling was simply lower than the number of open PRs.
#
# So capacity is something the preview job has to MANAGE, not assume. This
# script owns that policy so ci.yml stays a thin caller and the policy has a
# hermetic suite (scripts/__tests__/preview-db-branch.test.sh).
#
# SUBCOMMANDS
#   create <pr-number> --uri-out <path>
#       Replaces the PR's own preview branch (a push replaces, never
#       accumulates), writing the connection URI to <path> exactly as
#       neon-branch.sh create does. When Neon refuses with the allowance full it
#       reclaims capacity in this order, retrying the create after each step:
#         1. preview branches whose PR is CLOSED (merged or not). The
#            pull_request:closed cleanup can miss: a cancelled run, a secret
#            outage, a close that raced the preview job's own create.
#         2. the least recently CREATED preview branch whose PR state GitHub
#            could confirm, provided it is older than
#            $PREVIEW_DB_MIN_AGE_SECONDS. created_at is when that PR last pushed
#            (every push recreates the branch), so oldest-first is
#            least-recently-pushed-first. A branch younger than the preview
#            job's own timeout may still be mid-migration; one older cannot
#            belong to a running job. The evicted PR regains a branch on its
#            next push, and its number is printed (evicted_pr=N) so the caller
#            can say so on that PR rather than leave a preview URL that fails
#            on its first query with no explanation.
#       Prints branch_id= / branch_name= like neon-branch.sh create, plus
#       swept_pr=N per closed-PR branch step 1 deleted and evicted_pr=N /
#       evicted_branch=<id> when step 2 fired.
#   sweep
#       The scheduled half (preview-db-cleanup.yml). Deletes preview branches
#       of closed PRs, dry-run leftovers older than a day (cd.yml deletes its
#       own dry-run branch with always(); a cancelled run cannot), and
#       pre-migration snapshots past cd.yml's 14-day retention (cd.yml only
#       prunes those when the NEXT schema deploy happens). Never touches a
#       branch outside those three name shapes.
#   name <pr-number>
#       Prints the branch name for a PR: preview-pr-NNNNNN, zero-padded to six
#       digits.
#
# OUTPUT CHANNELS. The typed lines above (branch_id=, evicted_pr=, ...) go to
# STDOUT; every ::error::, ::warning:: and ::notice:: goes to STDERR, like
# neon-branch.sh. The caller captures stdout to read the typed lines and must
# still see the diagnostics when the script fails -- with them on stderr they
# reach the job log whatever the caller does with the capture.
#
# THE NAME IS FIXED-WIDTH ON PURPOSE. neon-branch.sh prune matches by
# `startswith`, so an unpadded "preview-pr-1" would prefix "preview-pr-12" and
# pruning PR 1 would delete PRs 12 through 19. Six digits make every name the
# same length, so no name can prefix another and startswith degenerates to
# equality. Everything here that reads a PR number back OUT of a name requires
# the full shape ^preview-pr-[0-9]{6}$; a branch that merely starts with the
# prefix is never treated as some PR's. (Above PR 999999 the name would widen
# to seven digits and stop matching that shape; such a branch could then only
# be reclaimed by the close event. This repository is nowhere near it.)
#
# PR STATE COMES FROM GITHUB, AND UNCERTAINTY MEANS KEEP -- in BOTH reclaim
# steps. `gh api` answers open or closed; a lookup that fails (rate limit,
# 404, no token) leaves the branch alone with a ::warning::, and it is never an
# eviction candidate either. Deleting on a guess would turn a transient GitHub
# error into a preview silently reading a database that no longer exists.
#
# THE AGE FLOOR EQUALS THE JOB TIMEOUT WITH NO MARGIN, DELIBERATELY. The
# branch is created several minutes INTO the preview job (after checkout and
# npm ci), and the job is killed at its timeout-minutes, so any branch older
# than the timeout belongs to a job that has already ended; the migrate and
# deploy steps that read the branch finish well inside that window besides.
#
# ENVIRONMENT
#   NEON_API_KEY, NEON_PROJECT_ID   required; consumed by neon-branch.sh, which
#                                   exits 2 without them
#   GH_TOKEN                        required for the PR-state lookups (`gh`)
#   GITHUB_REPOSITORY               owner/repo, as GitHub Actions sets it
#   PREVIEW_DB_MIN_AGE_SECONDS      optional, default 1800 = the preview job's
#                                   timeout-minutes. Never evict younger.
#
# EXIT CODES
#   0   success
#   2   missing NEON_API_KEY / NEON_PROJECT_ID (from neon-branch.sh)
#   3   Neon API error
#   5   the allowance was still full after every reclaim step and nothing was
#       safe to delete. That is "close some PRs or raise the plan", not a
#       pipeline bug, and the message says which.
#   64  usage error
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEON="$HERE/neon-branch.sh"
PREFIX='preview-pr-'
PR_NAME_RE='^preview-pr-[0-9]{6}$'
USAGE='usage: preview-db-branch.sh create <pr-number> --uri-out <path>
       preview-db-branch.sh sweep
       preview-db-branch.sh name <pr-number>'

: "${PREVIEW_DB_MIN_AGE_SECONDS:=1800}"
: "${GITHUB_REPOSITORY:=}"
case "$PREVIEW_DB_MIN_AGE_SECONDS" in ''|*[!0-9]*) PREVIEW_DB_MIN_AGE_SECONDS=1800 ;; esac

command -v jq >/dev/null 2>&1 || { echo "::error::preview-db-branch.sh requires jq" >&2; exit 3; }
[ -f "$NEON" ] || { echo "::error::neon-branch.sh not found next to preview-db-branch.sh" >&2; exit 3; }

pr_name() {
  local n="$1"
  case "$n" in
    ''|*[!0-9]*) echo "::error::pr-number must be a non-negative integer, got '${n}'" >&2; return 64 ;;
  esac
  printf 'preview-pr-%06d' "$((10#$n))"
}

# name -> PR number on stdout; rc 1 when the name is not a PR's (wrong width,
# no digits). Fixed width is what makes the parse unambiguous.
pr_of() {
  local name="$1"
  [[ "$name" =~ $PR_NAME_RE ]] || return 1
  printf '%d' "$((10#${name#"$PREFIX"}))"
}

# open | closed on stdout; rc 1 (nothing printed) when GitHub could not answer.
# stdin is closed so a call inside a `read` loop can never eat the loop's rows.
pr_state() {
  local n="$1" state
  [ -n "$GITHUB_REPOSITORY" ] || return 1
  state="$(gh api "repos/${GITHUB_REPOSITORY}/pulls/${n}" --jq '.state' 2>/dev/null </dev/null)" || return 1
  case "$state" in
    open|closed) printf '%s' "$state" ;;
    *) return 1 ;;
  esac
}

# id<TAB>name<TAB>created_at, oldest first. Non-zero when the LIST failed, and
# every caller propagates that: "could not list" must never read as "nothing
# there".
list_previews() { bash "$NEON" list "$PREFIX"; }

# neon-branch.sh delete waits for the deletion's operations to finish, so a
# create retried right after it is not racing the branch still being counted.
delete_branch() { bash "$NEON" delete "$1" >/dev/null </dev/null; }

# created_at -> epoch seconds, or nothing when it does not parse. Neon emits
# second precision; fractional seconds are tolerated in case that ever changes,
# because an unparseable date silently makes a row un-evictable.
epoch_of() {
  jq -rn --arg t "$1" '$t | sub("\\.[0-9]+Z$"; "Z") | try fromdateiso8601 catch empty' 2>/dev/null
}

# Step 1. Prints swept_pr=N per branch deleted and swept=<count>; keeps (with a
# warning) anything whose PR state is unknown.
sweep_closed() {
  local rows n=0 id name _created pr state
  rows="$(list_previews)" || return $?
  while IFS=$'\t' read -r id name _created; do
    [ -n "$id" ] || continue
    if ! pr="$(pr_of "$name")"; then
      echo "::notice::${name} does not carry a PR number; leaving it alone" >&2
      continue
    fi
    if ! state="$(pr_state "$pr")"; then
      echo "::warning::could not resolve the state of PR #${pr} for ${name}; keeping it" >&2
      continue
    fi
    [ "$state" = "closed" ] || continue
    if delete_branch "$id"; then
      echo "swept_pr=${pr}"
      n=$(( n + 1 ))
    else
      echo "::warning::could not delete ${name} (${id}) for closed PR #${pr}" >&2
    fi
  done <<<"$rows"
  echo "swept=${n}"
}

# Step 2. The oldest preview branch whose PR state GitHub confirmed, skipping
# our own name, anything whose state is unknown, and anything younger than the
# minimum age. Prints evicted_pr= and evicted_branch=; rc 1 when nothing
# qualifies, the list's own code when it failed.
evict_oldest() {
  local own="$1" rows id name created pr now ts age
  rows="$(list_previews)" || return $?
  now="$(date -u +%s)"
  while IFS=$'\t' read -r id name created; do
    [ -n "$id" ] || continue
    [ "$name" != "$own" ] || continue
    pr="$(pr_of "$name")" || continue
    if ! pr_state "$pr" >/dev/null; then
      echo "::warning::could not resolve the state of PR #${pr} for ${name}; not an eviction candidate" >&2
      continue
    fi
    ts="$(epoch_of "$created")"
    # No parseable age means no proof it is not in use.
    [ -n "$ts" ] || continue
    age=$(( now - ts ))
    [ "$age" -ge "$PREVIEW_DB_MIN_AGE_SECONDS" ] || continue
    if delete_branch "$id"; then
      echo "evicted_pr=${pr}"
      echo "evicted_branch=${id}"
      return 0
    fi
    echo "::warning::could not evict ${name} (${id}); trying the next oldest" >&2
  done <<<"$rows"
  return 1
}

# One create attempt: prints neon-branch.sh's output on success, returns its
# code (5 = allowance full) either way. The connection URI goes to the file,
# never through here.
try_create() {
  local name="$1" uri_out="$2" out rc=0
  out="$(bash "$NEON" create "$name" --endpoint --uri-out "$uri_out")" || rc=$?
  [ "$rc" -eq 0 ] && printf '%s\n' "$out"
  return "$rc"
}

cmd_create() {
  local pr="" uri_out=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --uri-out) uri_out="${2:-}"; [ -n "$uri_out" ] || { echo "::error::--uri-out needs a path" >&2; exit 64; }; shift 2 ;;
      -*) echo "::error::unknown flag '$1'" >&2; echo "$USAGE" >&2; exit 64 ;;
      *) [ -z "$pr" ] || { echo "::error::$USAGE" >&2; exit 64; }; pr="$1"; shift ;;
    esac
  done
  { [ -n "$pr" ] && [ -n "$uri_out" ]; } || { echo "::error::$USAGE" >&2; exit 64; }
  local name rc
  name="$(pr_name "$pr")" || exit 64

  # A push REPLACES the PR's branch. Retention 0 = everything with exactly this
  # name (fixed width makes startswith equality). Not fatal on its own: if the
  # old branch survives, the create below refuses loudly anyway.
  bash "$NEON" prune "$name" 0 || echo "::warning::could not prune the previous ${name}; continuing" >&2

  try_create "$name" "$uri_out"; rc=$?
  [ "$rc" -ne 0 ] || return 0
  [ "$rc" -eq 5 ] || exit "$rc"

  echo "::notice::Neon branch allowance is full; reclaiming preview branches of closed PRs" >&2
  sweep_closed || exit $?
  try_create "$name" "$uri_out"; rc=$?
  [ "$rc" -ne 0 ] || return 0
  [ "$rc" -eq 5 ] || exit "$rc"

  echo "::notice::still full after the closed-PR sweep; evicting the least recently built preview" >&2
  evict_oldest "$name"; rc=$?
  if [ "$rc" -eq 1 ]; then
    echo "::error::Neon branch allowance is full and nothing is safe to reclaim: every other preview branch is younger than ${PREVIEW_DB_MIN_AGE_SECONDS}s, may belong to a running preview job, or has a PR whose state GitHub could not confirm. Close or merge some PRs, or raise the plan's branch allowance, then re-run this job." >&2
    exit 5
  fi
  [ "$rc" -eq 0 ] || exit "$rc"
  try_create "$name" "$uri_out"; rc=$?
  [ "$rc" -ne 0 ] || return 0
  if [ "$rc" -eq 5 ]; then
    echo "::error::Neon still reports BRANCHES_LIMIT_EXCEEDED after reclaiming a branch. Something outside this pipeline is holding branches; audit with: bash scripts/neon-branch.sh list ''" >&2
    exit 5
  fi
  exit "$rc"
}

cmd_sweep() {
  [ $# -eq 0 ] || { echo "::error::$USAGE" >&2; exit 64; }
  local rc=0 step_rc
  sweep_closed || rc=$?
  # Housekeeping neon-branch.sh already knows how to do. Both warn, never fail,
  # on an individual delete; only a failed LIST reaches rc, and the first
  # failure wins so the cause is the code reported.
  bash "$NEON" prune 'db-dryrun-' 1 || { step_rc=$?; [ "$rc" -ne 0 ] || rc=$step_rc; }
  bash "$NEON" prune 'db-snapshot-' 14 || { step_rc=$?; [ "$rc" -ne 0 ] || rc=$step_rc; }
  exit "$rc"
}

cmd_name() {
  [ $# -eq 1 ] || { echo "::error::$USAGE" >&2; exit 64; }
  local name
  name="$(pr_name "$1")" || exit 64
  printf '%s\n' "$name"
}

case "${1:-}" in
  create) shift; cmd_create "$@" ;;
  sweep)  shift; cmd_sweep  "$@" ;;
  name)   shift; cmd_name   "$@" ;;
  *) echo "::error::$USAGE" >&2; exit 64 ;;
esac
