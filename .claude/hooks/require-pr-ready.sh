#!/usr/bin/env bash
# PreToolUse hook (Bash): refuse to call a PR ready unless GitHub says it is.
#
# WHY (#10328): on 2026-10-03 an agent moved PRs out of draft and posted board
# PASS verdicts while four Devin/Sentry review threads on #10305 and one on
# #10304 had sat unanswered for eight hours. The readiness audit that would have
# caught them (scripts/audit-pr-readiness.ps1) needs pwsh and GraphQL, and a
# Claude Code cloud session has neither, so the agent fell back to ad-hoc
# checks that never read review threads. A rule the agent must remember to run
# failed; this hook runs on the action itself.
#
# FIRES ON a Bash command that marks a PR ready or publishes a PASS for it:
#   - the ready-for-review route:        pulls/<n>/ccr/ready_for_review
#   - the gh CLI:                        gh pr ready <n>
#   - a board PASS verdict:              post-board-verdict.sh <n> PASS
#   - a PASS marker posted by hand:      issues/<n>/comments whose body (inline,
#                                        or the file named by body=@<file>)
#                                        carries `board-verdict: PASS`
# (`gh pr ready --undo`, which moves a PR back to draft, is not a ready call.)
# and, for each PR named, reads its CURRENT head from GitHub and BLOCKS unless:
#   1. every review thread is resolved — `GET pulls/<n>/ccr/review_threads`
#      (the cloud proxy's REST route), else the GraphQL `reviewThreads` query
#      (a local session, where gh can reach GraphQL);
#   2. no check run on the head failed, timed out, was cancelled, failed to
#      start or needs action, and none is still queued or running — each
#      check judged by its latest run (a re-run replaces a failed attempt);
#   2b. no legacy commit status on the head (Vercel, review-board, ...) is in
#      `failure` or `error`. A `pending` status does not block: review-board
#      reads pending until the very PASS this hook guards is posted;
#   3. GitHub reports no merge conflict (`mergeable_state` is not `dirty`,
#      and not `unknown` — still computing; retry in a few seconds).
# FAIL-CLOSED: a fact that cannot be read blocks, and the message says which.
# `gh pr ready` with no number cannot be checked, so it is blocked too.
#
# Exit 0 = allow, 2 = block (reason on stderr).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091  # dynamic $SCRIPT_DIR path; hook-utils.sh is linted on its own by the whole-tree glob
if ! source "$SCRIPT_DIR/hook-utils.sh"; then
  echo "BLOCKED: require-pr-ready could not load hook-utils.sh, so it cannot check readiness" >&2
  exit 2
fi

COMMAND=$(get_bash_command)
[ -n "$COMMAND" ] || exit 0

# PR numbers this command would mark ready or pass. A bare `gh pr ready` (no
# number: the current branch's PR) is recorded as "?" and blocked below.
PRS=()
while IFS= read -r n; do [ -n "$n" ] && PRS+=("$n"); done < <(
  { grep -oE 'pulls/[0-9]+/ccr/ready_for_review' <<<"$COMMAND" | grep -oE '[0-9]+'
    if ! grep -qE 'gh[[:space:]]+pr[[:space:]]+ready[^;&|]*--undo' <<<"$COMMAND"; then
      grep -oE 'gh[[:space:]]+pr[[:space:]]+ready([[:space:]]+[^[:space:];&|]+)?' <<<"$COMMAND" \
        | awk '{ n = $4; if (n ~ /^#?[0-9]+$/) { sub(/^#/, "", n); print n } else print "?" }'
    fi
    grep -oE 'post-board-verdict\.sh[[:space:]]+[0-9]+[[:space:]]+PASS([^A-Za-z0-9_]|$)' <<<"$COMMAND" \
      | awk '{ print $2 }'
    # A PASS marker posted as a comment: the body inline, or read from body=@file.
    body="$COMMAND"
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      if [ -r "$f" ]; then body+=$'\n'"$(cat "$f")"; else body+=$'\nboard-verdict: PASS'; fi
    done < <(grep -oE 'body=@[^[:space:];&|]+' <<<"$COMMAND" | sed -E "s/^body=@//; s/^[\"']//; s/[\"']\$//")
    # Only a command that POSTS a body (-f/-F body=...) can publish a marker; a
    # read that merely searches comments for one is not a ready call.
    if grep -qE '(^|[[:space:]])(-[fF]|--field|--raw-field)[[:space:]]+body=' <<<"$COMMAND" \
      && grep -qE 'board-verdict:[[:space:]]*PASS' <<<"$body"; then
      grep -oE 'issues/[0-9]+/comments' <<<"$COMMAND" | grep -oE '[0-9]+'
    fi
  } | sort -u)
[ "${#PRS[@]}" -gt 0 ] || exit 0

block() {
  echo "BLOCKED (require-pr-ready): $1" >&2
  echo "A PR is ready only when GitHub shows every review thread resolved, no failed or pending check on its head, and no merge conflict. Fix what is named above (answer and resolve each thread; fix or re-run the check; merge the base), then retry." >&2
  exit 2
}

command -v gh >/dev/null 2>&1 || block "gh is not installed, so readiness cannot be checked"
command -v jq >/dev/null 2>&1 || block "jq is not installed, so readiness cannot be checked"

# owner/repo: from the command when it names one, else from the origin remote
# (github.com URL or a proxy URL ending in /owner/repo).
REPO=$(grep -oE 'repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pulls' <<<"$COMMAND" | head -1 | sed -E 's#^repos/##; s#/pulls$##')
if [ -z "$REPO" ]; then
  REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#\.git$##; s#^.*[:/]([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$#\1#')
fi
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || block "cannot tell which repository the PR is in (origin remote: '$REPO')"

for pr in "${PRS[@]}"; do
  [ "$pr" != "?" ] || block "'gh pr ready' without a PR number cannot be checked; name the PR"

  info=$(gh api "repos/$REPO/pulls/$pr" 2>/dev/null) || block "cannot read PR #$pr from GitHub"
  head=$(jq -r '.head.sha // empty' <<<"$info" 2>/dev/null)
  state=$(jq -r '.mergeable_state // empty' <<<"$info" 2>/dev/null)
  [[ "$head" =~ ^[0-9a-f]{40}$ ]] || block "PR #$pr: GitHub returned no head commit"

  # 1. Review threads, by GitHub's own resolved flag.
  if threads=$(gh api "repos/$REPO/pulls/$pr/ccr/review_threads" 2>/dev/null) \
    && jq -e 'type == "array"' >/dev/null 2>&1 <<<"$threads"; then
    open=$(jq -r '[.[] | select(.resolved != true)] | map("\(.path // "?"):\(.line // "?") (comment \(.comment_ids[0] // "?"))") | join(", ")' <<<"$threads")
  else
    owner=${REPO%%/*}; name=${REPO#*/}
    # shellcheck disable=SC2016  # GraphQL variables, not shell expansions
    query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved path line comments(first:1){nodes{databaseId}}}}}}}'
    gq=$(gh api graphql -f query="$query" -f o="$owner" -f r="$name" -F n="$pr" 2>/dev/null) \
      || block "PR #$pr: cannot read its review threads (neither the ccr/review_threads route nor GraphQL answered)"
    t='.data.repository.pullRequest.reviewThreads'
    jq -e "$t.nodes | type == \"array\"" >/dev/null 2>&1 <<<"$gq" \
      || block "PR #$pr: the GraphQL review-thread answer had no thread list"
    [ "$(jq -r "$t.pageInfo.hasNextPage" <<<"$gq")" = "false" ] \
      || block "PR #$pr: more than 100 review threads; check them by hand"
    open=$(jq -r "[$t.nodes[] | select(.isResolved != true)] | map(\"\(.path // \"?\"):\(.line // \"?\") (comment \(.comments.nodes[0].databaseId // \"?\"))\") | join(\", \")" <<<"$gq")
  fi
  [ -z "$open" ] || block "PR #$pr has unresolved review threads: $open"

  # 2. Checks on the current head.
  checks=$(gh api --paginate "repos/$REPO/commits/$head/check-runs?per_page=100" 2>/dev/null) \
    || block "PR #$pr: cannot read the check runs on ${head:0:8}"
  # A check that ran more than once (a re-run, or a run superseded by a newer
  # trigger and cancelled) is judged by its LATEST run, as GitHub does: one
  # check per name and app, the highest run id.
  checks=$(jq -s '[.[].check_runs[]?] | group_by([.name, (.app.id // 0)]) | map(max_by(.id))' <<<"$checks" 2>/dev/null) \
    || block "PR #$pr: the check-run answer for ${head:0:8} was not JSON"
  [ "$(jq length <<<"$checks")" -gt 0 ] || block "PR #$pr: no check has run on ${head:0:8} yet"
  failed=$(jq -r '[.[] | select(.conclusion | IN("failure","timed_out","cancelled","startup_failure","action_required")) | .name] | unique | join(", ")' <<<"$checks")
  [ -z "$failed" ] || block "PR #$pr: checks did not pass on ${head:0:8}: $failed"
  pending=$(jq -r '[.[] | select(.status != "completed") | .name] | unique | join(", ")' <<<"$checks")
  [ -z "$pending" ] || block "PR #$pr: checks still running on ${head:0:8}: $pending"

  # 2b. Legacy commit statuses: a failed one blocks, a pending one does not.
  statuses=$(gh api "repos/$REPO/commits/$head/status" 2>/dev/null) \
    || block "PR #$pr: cannot read the commit statuses on ${head:0:8}"
  bad_status=$(jq -r '[.statuses[]? | select(.state == "failure" or .state == "error") | .context] | unique | join(", ")' <<<"$statuses" 2>/dev/null) \
    || block "PR #$pr: the commit-status answer for ${head:0:8} was not JSON"
  [ -z "$bad_status" ] || block "PR #$pr: commit statuses failed on ${head:0:8}: $bad_status"

  # 3. Mergeability.
  case "$state" in
    dirty) block "PR #$pr has a merge conflict with its base" ;;
    unknown|"") block "PR #$pr: GitHub has not finished computing mergeability; retry in a few seconds" ;;
  esac
done
exit 0
