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
#     scripts/post-board-verdict.sh <pr> <PASS|FAIL> <40-hex sha> <reported>/<total> [summary]
#
# The marker line is the contract, and nothing else in the comment is parsed:
#
#     <!-- board-verdict: PASS sha=<40-hex> seats=5/5 -->
#
# THE SEAT COUNT IS PART OF THE VERDICT (#10141). The protocol is five seats,
# any finding is a FAIL, and a PASS means "all five looked and none found
# anything". A marker without the count let a three-seat run publish PASS and
# `board-verdict.sh` render it `success` — adjacent to the property that
# matters (lessons-learned #1). So a PASS is refused here unless every seat
# reported, and the consumer treats a PASS that carries no count, or a partial
# one, as `pending`.
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
SEATS="${4:-}"
SUMMARY="${5:-}"

# The size of the board. Mirrors `REVIEWERS.length` in
# `.claude/workflows/review-board.js`; the suite derives that count from the
# workflow source and fails if the two drift.
BOARD_SEATS=5

usage() {
  echo "usage: post-board-verdict.sh <pr> <PASS|FAIL> <40-hex sha> <reported>/<total> [summary]" >&2
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

# THE SHA MUST BE A COMMIT THAT EXISTS. Well-formed is not the same as real, and
# the difference is a false claim: a verdict posted against a commit nobody ever
# built says a board reviewed something that does not exist, and reads as
# authoritative. Caught by making the mistake — a short sha padded out to forty
# characters passed every check above and posted a PASS on a live PR.
#
# `git cat-file -e` is the cheapest possible check and needs no network. Skipped
# only when this is not run inside a work tree, where there is nothing to check
# against and refusing would block the legitimate case.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if ! git cat-file -e "${SHA}^{commit}" 2>/dev/null; then
    echo "::error::${SHA} is not a commit in this repository — a verdict must name a commit that exists" >&2
    exit 2
  fi
fi

# <reported>/<total>: two integers, the total is the board's size, and a PASS
# needs every seat. Refused, not defaulted — a missing count is how a partial
# board published PASS in the first place.
case "$SEATS" in
  */*) ;;
  *) echo "::error::seats must be <reported>/<total>, got '${SEATS}'" >&2; usage ;;
esac
reported="${SEATS%%/*}"
total="${SEATS##*/}"
case "$reported" in
  ''|*[!0-9]*) echo "::error::seats must be <reported>/<total> with two integers, got '${SEATS}'" >&2; usage ;;
esac
case "$total" in
  ''|*[!0-9]*) echo "::error::seats must be <reported>/<total> with two integers, got '${SEATS}'" >&2; usage ;;
esac
if [ "$total" -ne "$BOARD_SEATS" ]; then
  echo "::error::the review board has ${BOARD_SEATS} seats; a verdict over ${total} is not a board verdict" >&2
  exit 2
fi
if [ "$reported" -gt "$total" ]; then
  echo "::error::${reported} seats cannot report on a ${total}-seat board" >&2
  exit 2
fi
if [ "$VERDICT" = "PASS" ] && [ "$reported" -ne "$total" ]; then
  echo "::error::a PASS needs every seat: only ${reported}/${total} reported — a partial board is not a pass; run the missing seats or post FAIL" >&2
  exit 2
fi

REPO="${GH_REPO:-Tristan578/project-forge}"
# TEST-ONLY seam, never set in CI — the suite asserts no workflow sets it, since
# pointing it at `true` would make this report success while posting nothing.
GH_CMD="${BOARD_VERDICT_GH_CMD:-gh}"

if [ "$VERDICT" = "PASS" ]; then
  headline="Review board: **PASS** at \`${SHA:0:8}\` (${reported}/${total} seats)"
else
  headline="Review board: **FAIL** at \`${SHA:0:8}\` (${reported}/${total} seats)"
fi

body="${headline}"
if [ -n "$SUMMARY" ]; then
  body="${body}

${SUMMARY}"
fi
body="${body}

<!-- board-verdict: ${VERDICT} sha=${SHA} seats=${reported}/${total} -->"

"$GH_CMD" api -X POST "repos/${REPO}/issues/${PR}/comments" \
  -f body="$body" >/dev/null || {
    echo "::error::failed to post the board verdict comment on PR ${PR}" >&2
    exit 2
  }

echo "posted board verdict ${VERDICT} (${reported}/${total} seats) for ${SHA:0:8} on PR ${PR}"
exit 0
