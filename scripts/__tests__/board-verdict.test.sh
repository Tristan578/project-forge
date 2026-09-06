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

# --- the seams must never be wired into CI ---
echo "seam hygiene"
if grep -rlE 'BOARD_VERDICT_(HEAD_SHA|COMMENTS_FILE|DRY_RUN)' "$ROOT/.github/workflows" 2>/dev/null | grep -q .; then
  FAIL=$((FAIL+1)); echo "  FAIL a workflow sets a test-only seam"
else
  PASS=$((PASS+1)); echo "  ok   no workflow sets a test-only seam"
fi

# --- the workflow must actually invoke the script ---
if grep -q 'scripts/board-verdict.sh' "$ROOT/.github/workflows/board-verdict.yml" 2>/dev/null; then
  PASS=$((PASS+1)); echo "  ok   the workflow invokes the script"
else
  FAIL=$((FAIL+1)); echo "  FAIL board-verdict.yml does not invoke the script"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "SUITE PASSED"
