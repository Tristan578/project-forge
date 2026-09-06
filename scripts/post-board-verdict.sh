#!/usr/bin/env bash
# Post a review-board result to a PR, carrying the marker `board-verdict.sh`
# reads.
#
# WHY THIS EXISTS. `board-verdict.sh` turns the newest marker on a PR into the
# `review-board` commit status. Without a producer, `success` and `failure` are
# UNREACHABLE STATES: the check would read `pending` on every PR forever, which
# is the same non-zero-forever signal that trained everyone to ignore the
# Chromatic amber (lessons-learned #13). A gate whose other half never runs is
# not a gate, and "the module is not done until the callers are wired" is this
# repo's own rule (agent-operations §7).
#
# So this is the other half. `.claude/workflows/review-board.js` computes the
# overall verdict and then runs this; a human running the board by hand runs it
# the same way.
#
#     scripts/post-board-verdict.sh <pr> <PASS|FAIL> <40-hex sha> [summary]
#
# The marker line is the contract, and nothing else in the comment is parsed:
#
#     <!-- board-verdict: PASS sha=<40-hex> -->
#
# The sha is the head the board actually reviewed, NOT "the current head" —
# those differ the moment a push lands mid-review, and recording the wrong one
# would let a stale verdict grade new code. `board-verdict.sh` compares it to
# the live head and reports `pending: stale` when they differ, so passing the
# reviewed sha is what makes that check work.
#
# bash 3.2 compatible, like the rest of the self-defense scripts.
set -uo pipefail

PR="${1:-}"
VERDICT="${2:-}"
SHA="${3:-}"
SUMMARY="${4:-}"

usage() {
  echo "usage: post-board-verdict.sh <pr> <PASS|FAIL> <40-hex sha> [summary]" >&2
  exit 2
}

[ -n "$PR" ] || usage
case "$PR" in
  *[!0-9]*|'') usage ;;
esac
case "$VERDICT" in
  PASS|FAIL) ;;
  *) echo "::error::verdict must be PASS or FAIL, got '${VERDICT}'" >&2; usage ;;
esac
# Fail closed on a short or malformed sha. `board-verdict.sh` only recognises 40
# hex characters, so posting anything else would produce a comment that reads
# like a verdict to a person and is invisible to the check — the worst of both.
case "$SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) echo "::error::sha must be 40 lowercase hex characters, got '${SHA}'" >&2; usage ;;
esac

REPO="${GH_REPO:-Tristan578/project-forge}"
# TEST-ONLY seam, never set in CI — the suite asserts no workflow sets it, since
# pointing it at `true` would make this report success while posting nothing.
GH_CMD="${BOARD_VERDICT_GH_CMD:-gh}"

if [ "$VERDICT" = "PASS" ]; then
  headline="Review board: **PASS** at \`${SHA:0:8}\`"
else
  headline="Review board: **FAIL** at \`${SHA:0:8}\`"
fi

body="${headline}"
if [ -n "$SUMMARY" ]; then
  body="${body}

${SUMMARY}"
fi
body="${body}

<!-- board-verdict: ${VERDICT} sha=${SHA} -->"

"$GH_CMD" api -X POST "repos/${REPO}/issues/${PR}/comments" \
  -f body="$body" >/dev/null || {
    echo "::error::failed to post the board verdict comment on PR ${PR}" >&2
    exit 2
  }

echo "posted board verdict ${VERDICT} for ${SHA:0:8} on PR ${PR}"
exit 0
