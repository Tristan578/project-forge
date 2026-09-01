#!/usr/bin/env bash
# resolve-ci-diff-range.sh — resolve the BASE..HEAD range that the ci-gate
# `Detect changed paths` step diffs, for every event ci.yml runs on.
#
# WHY THIS EXISTS (#9161 / #9193 / #9381 / #9495)
# -----------------------------------------------
# ci.yml used to be `pull_request`-only and read the range straight out of
# `github.event.pull_request.{base,head}.sha`. That stranded every bot-authored
# PR, because GitHub's recursion guard says: "events triggered by the
# GITHUB_TOKEN will not create a new workflow run, with the following
# exceptions: workflow_dispatch and repository_dispatch events always create
# workflow runs" — and, for `pull_request` opened/synchronize/reopened, runs are
# created but held in an approval-required state.
#
# So the changesets release PR (changeset-release/main) got ZERO Actions checks
# and the Coverage Ratchet PR (auto/coverage-ratchet) got checks held at
# `action_required` — in both cases the required "CI Success" check never
# reported and the PR was permanently unmergeable. `workflow_dispatch` is the
# documented exception, so ci.yml now carries that trigger and the two producing
# workflows fire it against their own branch after pushing. This script is what
# lets the same ci-gate serve both events.
#
# CONTRACT
# --------
# Reads (env):
#   EVENT_NAME      github.event_name
#   PR_BASE_SHA     github.event.pull_request.base.sha  (pull_request only)
#   PR_HEAD_SHA     github.event.pull_request.head.sha  (pull_request only)
#   PUSH_BEFORE_SHA github.event.before                 (push only)
#   PUSH_HEAD_SHA   github.sha                          (push only)
#   DISPATCH_SHA    github.sha                          (workflow_dispatch)
#   DEFAULT_BRANCH  the repo default branch, e.g. `main`
#   GITHUB_OUTPUT   step-output file
# Writes: `base-sha=` and `head-sha=` to $GITHUB_OUTPUT.
#
# FAILURE POSTURE — the important part. Every ci-gate output is a grep over the
# resolved diff. An EMPTY diff is not a safe default: it sets all fourteen
# filters false, every path-gated job legitimately skips, and check-ci-success.sh
# tolerates legitimate skips — so a silent resolution failure would render a
# fully green "CI Success" that ran nothing. This script therefore exits
# non-zero on any unresolved input rather than emitting a range it is not sure
# of. Never soften that into a fallback.
set -uo pipefail

EVENT_NAME="${EVENT_NAME:-}"
PR_BASE_SHA="${PR_BASE_SHA:-}"
PR_HEAD_SHA="${PR_HEAD_SHA:-}"
PUSH_BEFORE_SHA="${PUSH_BEFORE_SHA:-}"
PUSH_HEAD_SHA="${PUSH_HEAD_SHA:-}"
DISPATCH_SHA="${DISPATCH_SHA:-}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
GITHUB_OUTPUT="${GITHUB_OUTPUT:-}"

die() {
  echo "::error::resolve-ci-diff-range: $1"
  exit 1
}

[ -n "$GITHUB_OUTPUT" ] || die "GITHUB_OUTPUT is unset — nowhere to write the resolved range"

case "$EVENT_NAME" in
  pull_request)
    [ -n "$PR_BASE_SHA" ] || die "pull_request event with an empty base SHA"
    [ -n "$PR_HEAD_SHA" ] || die "pull_request event with an empty head SHA"
    base_sha="$PR_BASE_SHA"
    head_sha="$PR_HEAD_SHA"
    ;;
  push)
    [ -n "$PUSH_BEFORE_SHA" ] || die "push event with an empty before SHA"
    [ -n "$PUSH_HEAD_SHA" ] || die "push event with an empty head SHA"
    [ "$PUSH_BEFORE_SHA" != "0000000000000000000000000000000000000000" ] \
      || die "push event has an all-zero before SHA — refusing to turn a first/forced push into an empty green run"
    base_sha="$PUSH_BEFORE_SHA"
    head_sha="$PUSH_HEAD_SHA"
    ;;
  workflow_dispatch)
    [ -n "$DISPATCH_SHA" ] || die "workflow_dispatch event with an empty github.sha"
    head_sha="$DISPATCH_SHA"

    # `actions/checkout` fetches the dispatched ref only, so the default branch
    # may have no local ref to merge-base against. Fetch it on demand; the
    # checkout step leaves credentials configured for this.
    if ! git rev-parse --verify --quiet "refs/remotes/origin/${DEFAULT_BRANCH}" >/dev/null; then
      git fetch --no-tags --quiet origin \
        "+refs/heads/${DEFAULT_BRANCH}:refs/remotes/origin/${DEFAULT_BRANCH}" 2>/dev/null \
        || die "cannot fetch origin/${DEFAULT_BRANCH} to resolve the diff base"
    fi

    base_sha="$(git merge-base "refs/remotes/origin/${DEFAULT_BRANCH}" "$head_sha" 2>/dev/null)"
    [ -n "$base_sha" ] \
      || die "no merge-base between origin/${DEFAULT_BRANCH} and ${head_sha} — refusing to emit an empty diff range"
    ;;
  "")
    die "EVENT_NAME is unset"
    ;;
  *)
    die "unsupported event '${EVENT_NAME}' — ci.yml runs on pull_request, push, and workflow_dispatch only"
    ;;
esac

{
  echo "base-sha=${base_sha}"
  echo "head-sha=${head_sha}"
} >> "$GITHUB_OUTPUT"

echo "Diff range for ${EVENT_NAME}: ${base_sha}..${head_sha}"
