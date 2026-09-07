#!/usr/bin/env bash
# Turn the latest review-board verdict on a PR into a commit status.
#
# WHY THIS EXISTS. On 2026-09-06 #9725 was merged while a review board still had
# two majors open. The board had run, it had FAILED, and the agent fixing it was
# killed mid-run — but the PR showed green CI and no unresolved threads, and the
# report the owner acted on led with the green. The board verdict lived only in
# a conversation, so nothing on the PR contradicted "ready".
#
# Both blockers reached `main`: the capability gate could strand itself at
# `loading: true` for a whole session (every capability then read as available,
# including one that is permanently unavailable), and the Audio inspector's
# badge contradicted its own accessible name for every free-tier user. A bot
# re-found one of them a day later on the stacked PR.
#
# So: a board verdict is no longer something a human has to remember to mention.
# It becomes a check on the PR, next to CI, and it is PENDING until a board has
# actually run against the current head.
#
# THE MARKER. A board result comment must carry, on its own line:
#     <!-- board-verdict: PASS sha=<40-hex> -->
#     <!-- board-verdict: FAIL sha=<40-hex> -->
# The sha is the head the board reviewed. Anything else is prose.
#
# STATUS SET (context `review-board`):
#   FAIL for head            -> failure  ("board found N findings at <sha>")
#   PASS for head            -> success
#   verdict for another sha  -> pending  ("stale: board ran at <sha>, head is <head>")
#   no verdict at all        -> pending  ("no board verdict for this head")
#
# Pending rather than success on absence is the whole point: "nobody looked" and
# "someone looked and it was clean" must not render identically, which is the
# mistake this encodes against.
#
# bash 3.2 compatible (macOS system bash), like the other self-defense scripts.
set -uo pipefail

PR="${1:-}"
if [ -z "$PR" ]; then
  echo "usage: board-verdict.sh <pr-number>" >&2
  exit 2
fi

REPO="${GH_REPO:-Tristan578/project-forge}"

# TEST-ONLY seams, never set in CI (the suite asserts no workflow sets them):
# BOARD_VERDICT_HEAD_SHA supplies the head and BOARD_VERDICT_COMMENTS_FILE the
# comment bodies, so the decision logic is testable without the network.
if [ -n "${BOARD_VERDICT_HEAD_SHA:-}" ]; then
  head_sha="$BOARD_VERDICT_HEAD_SHA"
else
  head_sha="$(gh api "repos/${REPO}/pulls/${PR}" --jq '.head.sha' 2>/dev/null)"
fi
if [ -z "$head_sha" ]; then
  echo "::error::could not read head sha for PR ${PR}" >&2
  exit 2
fi

# Newest marker wins. Comments come back oldest-first, so take the last match.
#
# ONLY A WRITER'S COMMENT COUNTS. The status means "a review board ran", and a
# check whose meaning is that must not be writable by the party under review: on
# a public repository anyone who can comment could otherwise assert
# `PASS sha=<head>` and turn their own PR green. `author_association` is
# GitHub's own answer to who the commenter is relative to the repo, and it is
# computed server-side from the comment, not from anything the commenter writes.
if [ -n "${BOARD_VERDICT_COMMENTS_FILE:-}" ]; then
  comments="$(cat "$BOARD_VERDICT_COMMENTS_FILE" 2>/dev/null)"
else
  comments="$(gh api "repos/${REPO}/issues/${PR}/comments" --paginate \
    --jq '.[] | select(.author_association == "OWNER" or .author_association == "MEMBER" or .author_association == "COLLABORATOR") | .body' 2>/dev/null)"
fi
marker="$(echo "$comments" | grep -oE '<!-- board-verdict: (PASS|FAIL) sha=[0-9a-f]{40} -->' | tail -1)"

state="pending"
description="no board verdict for this head — run the review board"

if [ -n "$marker" ]; then
  verdict="$(printf '%s' "$marker" | grep -oE '(PASS|FAIL)')"
  vsha="$(printf '%s' "$marker" | grep -oE '[0-9a-f]{40}')"
  if [ "$vsha" != "$head_sha" ]; then
    state="pending"
    description="stale: board ran at ${vsha:0:8}, head is ${head_sha:0:8}"
  elif [ "$verdict" = "FAIL" ]; then
    state="failure"
    description="review board FAILED at ${head_sha:0:8}"
  else
    state="success"
    description="review board passed at ${head_sha:0:8}"
  fi
fi

# GitHub truncates a status description at 140 characters.
description="$(printf '%s' "$description" | cut -c1-140)"

if [ "${BOARD_VERDICT_DRY_RUN:-}" = "true" ]; then
  echo "${state}: ${description}"
  exit 0
fi

# THE WRITE GOES THROUGH A SEAM so the suite can observe it. Every test used to
# stop at the dry-run exit above, which meant nothing asserted what is actually
# PUBLISHED: hardcoding `state=success` on the line below, or writing the status
# under a context nobody looks at, left all fourteen cases green while the gate
# reported the opposite of its own decision. BOARD_VERDICT_GH_CMD is test-only —
# the suite asserts no workflow sets it, since pointing it at `true` would make
# the job succeed while publishing nothing.
GH_CMD="${BOARD_VERDICT_GH_CMD:-gh}"

"$GH_CMD" api -X POST "repos/${REPO}/statuses/${head_sha}" \
  -f state="$state" \
  -f context="review-board" \
  -f description="$description" >/dev/null || {
    echo "::error::failed to set the review-board status on ${head_sha}" >&2
    exit 2
  }

echo "review-board status on ${head_sha:0:8}: ${state} — ${description}"
[ "$state" = "failure" ] && exit 1
exit 0
