#!/usr/bin/env bash
# Decision-logic tests for scripts/board-verdict.sh.
#
# Hermetic: BOARD_VERDICT_HEAD_SHA and BOARD_VERDICT_COMMENTS_FILE stand in for
# the two GitHub reads, and BOARD_VERDICT_DRY_RUN keeps it from posting a
# status. The suite asserts no workflow sets those seams — wiring one would
# make the check grade a fixture instead of the PR.
#
# The case that matters is `pending` on absence: #9725 merged with a red board
# because nothing on the PR distinguished "nobody looked" from "clean".
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/board-verdict.sh"
PASS=0
FAIL=0

HEAD="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
OTHER="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

run_case() {
  local name="$1" expected="$2" body="$3"
  printf '%s\n' "$body" > "$TMP/comments.txt"
  local out
  out="$(BOARD_VERDICT_DRY_RUN=true \
        BOARD_VERDICT_HEAD_SHA="$HEAD" \
        BOARD_VERDICT_COMMENTS_FILE="$TMP/comments.txt" \
        bash "$SCRIPT" 1 2>&1)"
  case "$out" in
    "$expected"*) PASS=$((PASS+1)); echo "  ok   $name -> $out" ;;
    *) FAIL=$((FAIL+1)); echo "  FAIL $name: expected '$expected*', got '$out'" ;;
  esac
}

echo "board-verdict decision logic"

run_case "no comments at all"            pending ""
run_case "comments but no marker"        pending "LGTM, looks fine to me"
run_case "PASS for this head"            success "board ran<!-- board-verdict: PASS sha=$HEAD -->"
run_case "FAIL for this head"            failure "found 2<!-- board-verdict: FAIL sha=$HEAD -->"
run_case "PASS for a different head"     pending "<!-- board-verdict: PASS sha=$OTHER -->"
run_case "FAIL for a different head"     pending "<!-- board-verdict: FAIL sha=$OTHER -->"

# Newest wins: a PR is boarded repeatedly and only the last verdict is current.
run_case "FAIL then PASS, same head"     success "$(printf '<!-- board-verdict: FAIL sha=%s -->\n<!-- board-verdict: PASS sha=%s -->' "$HEAD" "$HEAD")"
run_case "PASS then FAIL, same head"     failure "$(printf '<!-- board-verdict: PASS sha=%s -->\n<!-- board-verdict: FAIL sha=%s -->' "$HEAD" "$HEAD")"

# A stale PASS must not be rescued by an older marker for the current head:
# the LAST marker is the verdict, and it is stale.
run_case "current PASS then stale PASS"  pending "$(printf '<!-- board-verdict: PASS sha=%s -->\n<!-- board-verdict: PASS sha=%s -->' "$HEAD" "$OTHER")"

# Near-misses must not be read as verdicts.
run_case "wrong verdict word"            pending "<!-- board-verdict: MAYBE sha=$HEAD -->"
run_case "short sha"                     pending "<!-- board-verdict: PASS sha=aaaaaaa -->"
run_case "prose mentioning PASS"         pending "the board came back PASS at $HEAD"

# --- WHAT IS ACTUALLY PUBLISHED ---
#
# Every case above stops at the dry-run exit, so none of them can see the POST.
# Measured: hardcoding `state=success` immediately above the `gh api` call left
# all fourteen green while every FAIL published green, and renaming the context
# put the status somewhere nobody looks with the same result. So these drive the
# real publication path through a recorder standing in for `gh`.
echo "the published status"

RECORD="$TMP/gh-calls.txt"
cat > "$TMP/gh-stub" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GH_STUB_RECORD"
exit 0
STUB
chmod +x "$TMP/gh-stub"

# publish_case <name> <expected substring> <comments body>
publish_case() {
  local name="$1" expected="$2" body="$3"
  : > "$RECORD"
  printf '%s\n' "$body" > "$TMP/comments.txt"
  GH_STUB_RECORD="$RECORD" \
    BOARD_VERDICT_GH_CMD="$TMP/gh-stub" \
    BOARD_VERDICT_HEAD_SHA="$HEAD" \
    BOARD_VERDICT_COMMENTS_FILE="$TMP/comments.txt" \
    bash "$SCRIPT" 1 >/dev/null 2>&1
  if grep -qF "$expected" "$RECORD"; then
    PASS=$((PASS+1)); echo "  ok   $name"
  else
    FAIL=$((FAIL+1)); echo "  FAIL $name: nothing published matching '$expected'"
    sed 's/^/         /' "$RECORD" | head -3
  fi
}

publish_case "a FAIL verdict publishes state=failure"  'state=failure' "<!-- board-verdict: FAIL sha=$HEAD -->"
publish_case "a PASS verdict publishes state=success"  'state=success' "<!-- board-verdict: PASS sha=$HEAD -->"
publish_case "no verdict publishes state=pending"      'state=pending' "nothing to see here"
publish_case "the status is written under review-board" 'context=review-board' "<!-- board-verdict: FAIL sha=$HEAD -->"
publish_case "the status is written against the head"  "statuses/$HEAD" "<!-- board-verdict: PASS sha=$HEAD -->"

# A FAIL must publish AND exit non-zero, so the script is usable as a local gate
# even though the workflow deliberately keeps the failing STATUS as the signal.
: > "$RECORD"
printf '%s\n' "<!-- board-verdict: FAIL sha=$HEAD -->" > "$TMP/comments.txt"
GH_STUB_RECORD="$RECORD" BOARD_VERDICT_GH_CMD="$TMP/gh-stub" \
  BOARD_VERDICT_HEAD_SHA="$HEAD" BOARD_VERDICT_COMMENTS_FILE="$TMP/comments.txt" \
  bash "$SCRIPT" 1 >/dev/null 2>&1
if [ $? -eq 1 ]; then
  PASS=$((PASS+1)); echo "  ok   a FAIL exits 1 after publishing"
else
  FAIL=$((FAIL+1)); echo "  FAIL a FAIL verdict did not exit 1"
fi

# --- the producer: without it, success and failure are unreachable states ---
echo "the producer"

POST="$ROOT/scripts/post-board-verdict.sh"

post_case() {
  local name="$1" expected="$2"
  shift 2
  : > "$RECORD"
  GH_STUB_RECORD="$RECORD" BOARD_VERDICT_GH_CMD="$TMP/gh-stub" bash "$POST" "$@" >/dev/null 2>&1
  if grep -qF "$expected" "$RECORD"; then
    PASS=$((PASS+1)); echo "  ok   $name"
  else
    FAIL=$((FAIL+1)); echo "  FAIL $name: nothing published matching '$expected'"
  fi
}

post_case "a PASS comment carries the marker board-verdict.sh reads" \
  "<!-- board-verdict: PASS sha=$HEAD -->" 1 PASS "$HEAD"
post_case "a FAIL comment carries the marker" \
  "<!-- board-verdict: FAIL sha=$HEAD -->" 1 FAIL "$HEAD"

# The round trip is the point: what the producer writes must be what the
# consumer recognises. Asserting the two regexes separately would let them drift.
: > "$RECORD"
GH_STUB_RECORD="$RECORD" BOARD_VERDICT_GH_CMD="$TMP/gh-stub" \
  bash "$POST" 1 FAIL "$HEAD" "3 of 5 reviewers failed" >/dev/null 2>&1
cp "$RECORD" "$TMP/comments.txt"
run_case "a posted FAIL is read back as a failure" failure "$(cat "$TMP/comments.txt")"

# Malformed input must not produce a comment that reads like a verdict to a
# person and is invisible to the check.
for bad in "1 MAYBE $HEAD" "1 PASS aaaaaaa" "1 PASS" "x PASS $HEAD"; do
  : > "$RECORD"
  # shellcheck disable=SC2086
  GH_STUB_RECORD="$RECORD" BOARD_VERDICT_GH_CMD="$TMP/gh-stub" bash "$POST" $bad >/dev/null 2>&1
  if [ -s "$RECORD" ]; then
    FAIL=$((FAIL+1)); echo "  FAIL the producer posted something for bad args: $bad"
  else
    PASS=$((PASS+1)); echo "  ok   the producer refuses bad args and posts nothing: $bad"
  fi
done

# --- only a writer's comment counts ---
#
# The status means "a review board ran". On a public repository, a check whose
# meaning is that must not be writable by the party under review.
if grep -q 'author_association' "$SCRIPT"; then
  PASS=$((PASS+1)); echo "  ok   comments are filtered by author association"
else
  FAIL=$((FAIL+1)); echo "  FAIL any commenter could assert a verdict"
fi

# --- the seams must never be wired into CI ---
echo "seam hygiene"
if grep -rlE 'BOARD_VERDICT_(HEAD_SHA|COMMENTS_FILE|DRY_RUN|GH_CMD)' "$ROOT/.github/workflows" 2>/dev/null | grep -q .; then
  FAIL=$((FAIL+1)); echo "  FAIL a workflow sets a test-only seam"
else
  PASS=$((PASS+1)); echo "  ok   no workflow sets a test-only seam"
fi

# --- the workflow must actually invoke the script, and not be neuterable ---
WF="$ROOT/.github/workflows/board-verdict.yml"
if grep -q 'scripts/board-verdict.sh' "$WF" 2>/dev/null; then
  PASS=$((PASS+1)); echo "  ok   the workflow invokes the script"
else
  FAIL=$((FAIL+1)); echo "  FAIL board-verdict.yml does not invoke the script"
fi

# YAML keeps the LAST duplicate key, so appending a second `run:` replaces the
# effective command while the pinned line stays byte-present and a containment
# grep still passes (gotchas-build-ci.md). On the `pull_request` path GitHub
# runs the PR's OWN workflow file, so such a neuter lands in the very run that
# should catch it. Count instead of contain.
run_count="$(grep -cE '^ +run:' "$WF" 2>/dev/null || true)"
if [ "$run_count" -eq 1 ]; then
  PASS=$((PASS+1)); echo "  ok   board-verdict.yml has exactly one run: key"
else
  FAIL=$((FAIL+1)); echo "  FAIL board-verdict.yml has $run_count run: keys (expected 1)"
fi

if grep -qE '^ +continue-on-error:' "$WF" 2>/dev/null; then
  FAIL=$((FAIL+1)); echo "  FAIL continue-on-error would hide a tooling failure"
else
  PASS=$((PASS+1)); echo "  ok   no continue-on-error shadows the step"
fi

# `|| true` swallowed exit 2 as well as exit 1. Exit 1 is the FAIL verdict, and
# the failing STATUS is the signal there, so reddening the job would duplicate
# it. Exit 2 is a tooling failure that posts NO status at all — and an absent
# status renders as nothing, not as pending, which is silence exactly where the
# design says silence is the bug.
if grep -qE '\|\| *\[ *\$\? *-eq *1 *\]' "$WF" 2>/dev/null; then
  PASS=$((PASS+1)); echo "  ok   only the FAIL exit is swallowed, not a tooling error"
else
  FAIL=$((FAIL+1)); echo "  FAIL the step swallows every non-zero exit, including exit 2"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "SUITE PASSED"
