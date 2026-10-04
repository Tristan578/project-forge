#!/usr/bin/env bash
# Tests for .claude/hooks/require-pr-ready.sh (#10328).
#
# The hook calls `gh`. These tests put a fake `gh` FIRST ON PATH that answers
# from fixture files in $FAKE, so the hook itself carries no test seam (there
# is no override variable for CI to wire). The fake fails any route it was not
# given a fixture for, which is how the fail-closed paths are driven.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../require-pr-ready.sh"
for tool in jq git; do
  command -v "$tool" >/dev/null 2>&1 || { echo "FAIL: $tool is required by this suite"; exit 1; }
done
[ -f "$HOOK" ] || { echo "FAIL: hook not found: $HOOK"; exit 1; }

PASS=0
FAIL=0
ok() { echo "  ok    $1"; PASS=$((PASS + 1)); }
readonly -f ok
bad() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }
readonly -f bad

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAKE="$TMP/fake"
mkdir -p "$TMP/bin" "$FAKE"
HEAD_SHA=0123456789abcdef0123456789abcdef01234567

# The fake gh: `gh api <route>` prints $FAKE/<file> for the routes the hook
# uses, and exits 1 when that file is absent. Any other invocation exits 1.
cat > "$TMP/bin/gh" <<'FAKEGH'
#!/usr/bin/env bash
[ "${1:-}" = "api" ] || exit 1
shift
route=""
for a in "$@"; do
  case "$a" in
    --paginate) ;;
    -*) ;;
    *) [ -z "$route" ] && route="$a" ;;
  esac
done
printf '%s\n' "$route" >> "$FAKE_DIR/calls.log"
case "$route" in
  graphql) f=graphql.json ;;
  repos/*/pulls/*/ccr/review_threads) f=threads.json ;;
  repos/*/commits/*/check-runs*) f=checks.json ;;
  repos/*/commits/*/status) f=status.json ;;
  repos/*/pulls/*) f=pr.json ;;
  *) exit 1 ;;
esac
[ -f "$FAKE_DIR/$f" ] || exit 1
cat "$FAKE_DIR/$f"
FAKEGH
chmod +x "$TMP/bin/gh"

# fixtures <mergeable_state> <threads-json|-> <checks-json|-> [graphql-json]
# Writes a fresh fixture set; "-" leaves that route unanswered.
fixtures() {
  rm -f "$FAKE"/*.json
  : > "$FAKE/calls.log"
  jq -nc --arg s "$1" --arg h "$HEAD_SHA" '{head:{sha:$h}, mergeable_state:$s}' > "$FAKE/pr.json"
  [ "$2" = "-" ] || printf '%s\n' "$2" > "$FAKE/threads.json"
  [ "$3" = "-" ] || printf '%s\n' "$3" > "$FAKE/checks.json"
  printf '%s\n' '{"state":"success","statuses":[]}' > "$FAKE/status.json"
  [ -z "${4:-}" ] || printf '%s\n' "$4" > "$FAKE/graphql.json"
}
readonly -f fixtures

GREEN='{"check_runs":[{"name":"Lint","status":"completed","conclusion":"success"},{"name":"Docs","status":"completed","conclusion":"skipped"}]}'
RESOLVED='[{"resolved":true,"path":"a.ts","line":3,"comment_ids":[11,12]}]'
OPEN='[{"resolved":true,"path":"a.ts","line":3,"comment_ids":[11]},{"resolved":false,"path":"b.sh","line":7,"comment_ids":[99]}]'

# run_hook <command> — runs the hook as Claude Code does (stdin JSON), with the
# fake gh first on PATH and the repo's origin remote available.
run_hook() {
  OUT=$(jq -nc --arg c "$1" '{tool_input:{command:$c}}' \
    | (cd "$HERE" && PATH="$TMP/bin:$PATH" FAKE_DIR="$FAKE" bash "$HOOK" 2>&1))
  RC=$?
}
readonly -f run_hook
expect_block() { # <label> <command> <stderr substring>
  run_hook "$2"
  if [ "$RC" -eq 2 ] && grep -qF -- "$3" <<<"$OUT"; then ok "$1"; else bad "$1 (rc=$RC): $OUT"; fi
}
readonly -f expect_block
expect_allow() { # <label> <command>
  run_hook "$2"
  if [ "$RC" -eq 0 ]; then ok "$1"; else bad "$1 (rc=$RC): $OUT"; fi
}
readonly -f expect_allow

READY='gh api -X POST repos/Tristan578/project-forge/pulls/10305/ccr/ready_for_review'
echo "=== require-pr-ready.sh ==="

# --- Commands that are not a ready call pass straight through.
fixtures clean "$OPEN" "$GREEN"
expect_allow "an unrelated gh call is not checked" 'gh api repos/Tristan578/project-forge/pulls/10305'
expect_allow "a FAIL verdict is not a ready call" 'bash scripts/post-board-verdict.sh 10305 FAIL abc 5/5 "x"'
expect_allow "gh pr ready --undo (back to draft) is not a ready call" 'gh pr ready 10305 --undo'
expect_allow "convert_to_draft is not a ready call" 'gh api -X POST repos/Tristan578/project-forge/pulls/10305/ccr/convert_to_draft'
expect_allow "a read that searches comments for a PASS marker is not a ready call" \
  "gh api 'repos/Tristan578/project-forge/issues/10305/comments?per_page=100' --jq '[.[] | select(.body|test(\"board-verdict: PASS\"))] | length'"
expect_allow "a comment without a PASS marker is not a ready call" \
  'gh api -X POST repos/Tristan578/project-forge/issues/10305/comments -f body="thanks"'

# --- A ready PR is allowed through every trigger.
fixtures clean "$RESOLVED" "$GREEN"
expect_allow "ready route: resolved threads, green checks, clean merge" "$READY"
expect_allow "gh pr ready <n>" 'gh pr ready 10305'
expect_allow "gh pr ready #<n>" 'gh pr ready #10305'
expect_allow "post-board-verdict.sh <n> PASS" 'bash scripts/post-board-verdict.sh 10305 PASS abc 5/5 "ok"'
fixtures blocked "$RESOLVED" "$GREEN"
expect_allow "mergeable_state blocked (waiting on approval) is not a conflict" "$READY"
fixtures behind "$RESOLVED" "$GREEN"
expect_allow "mergeable_state behind is not a conflict" "$READY"
fixtures clean '[]' "$GREEN"
expect_allow "a PR with no review threads at all" "$READY"

# --- Each readiness fact, broken alone, blocks — through every trigger.
fixtures clean "$OPEN" "$GREEN"
expect_block "an unresolved thread blocks the ready route, naming it" "$READY" 'unresolved review threads: b.sh:7 (comment 99)'
expect_block "an unresolved thread blocks gh pr ready" 'gh pr ready 10305' 'unresolved review threads'
expect_block "an unresolved thread blocks a board PASS" 'bash scripts/post-board-verdict.sh 10305 PASS abc 5/5 "ok"' 'unresolved review threads'
expect_block "an unresolved thread blocks an inline PASS marker comment" \
  'gh api -X POST repos/Tristan578/project-forge/issues/10305/comments -f body="<!-- board-verdict: PASS sha=abc seats=5/5 -->"' \
  'unresolved review threads'
printf '<!-- board-verdict: PASS sha=%s seats=5/5 -->\nok\n' "$HEAD_SHA" > "$TMP/verdict.md"
expect_block "an unresolved thread blocks a PASS marker posted from body=@file" \
  "gh api -X POST repos/Tristan578/project-forge/issues/10305/comments -F body=@$TMP/verdict.md" \
  'unresolved review threads'
expect_block "a body file that cannot be read is treated as a PASS marker" \
  "gh api -X POST repos/Tristan578/project-forge/issues/10305/comments -F body=@$TMP/missing.md" \
  'unresolved review threads'
fixtures clean "$RESOLVED" '{"check_runs":[{"name":"Lint","status":"completed","conclusion":"success"},{"name":"Web Tests","status":"completed","conclusion":"failure"}]}'
expect_block "a failed check blocks, naming it" "$READY" 'checks did not pass on 01234567: Web Tests'
for c in timed_out cancelled startup_failure action_required; do
  fixtures clean "$RESOLVED" "{\"check_runs\":[{\"name\":\"E2E\",\"status\":\"completed\",\"conclusion\":\"$c\"}]}"
  expect_block "a $c check blocks" "$READY" 'checks did not pass on 01234567: E2E'
done
fixtures clean "$RESOLVED" '{"check_runs":[{"name":"Lint","status":"completed","conclusion":"success"},{"name":"Hook Tests (Windows)","status":"in_progress","conclusion":null}]}'
expect_block "a running check blocks, naming it" "$READY" 'checks still running on 01234567: Hook Tests (Windows)'
fixtures clean "$RESOLVED" '{"check_runs":[]}'
expect_block "a head with no checks at all blocks" "$READY" 'no check has run on 01234567'
fixtures dirty "$RESOLVED" "$GREEN"
expect_block "a merge conflict blocks" "$READY" 'has a merge conflict'
fixtures unknown "$RESOLVED" "$GREEN"
expect_block "mergeability still computing blocks" "$READY" 'not finished computing mergeability'

# --- A check judged by its LATEST run: a re-run that passed replaces a
# cancelled or failed attempt; a re-run that failed replaces a pass.
fixtures clean "$RESOLVED" '{"check_runs":[{"id":1,"name":"Require Changeset","status":"completed","conclusion":"cancelled","app":{"id":15368}},{"id":2,"name":"Require Changeset","status":"completed","conclusion":"success","app":{"id":15368}}]}'
expect_allow "a cancelled run superseded by a passing re-run does not block" "$READY"
fixtures clean "$RESOLVED" '{"check_runs":[{"id":2,"name":"Lint","status":"completed","conclusion":"failure","app":{"id":15368}},{"id":1,"name":"Lint","status":"completed","conclusion":"success","app":{"id":15368}}]}'
expect_block "a failed re-run after a pass blocks" "$READY" 'checks did not pass on 01234567: Lint'
fixtures clean "$RESOLVED" '{"check_runs":[{"id":1,"name":"Scan","status":"completed","conclusion":"failure","app":{"id":1}},{"id":2,"name":"Scan","status":"completed","conclusion":"success","app":{"id":2}}]}'
expect_block "a same-named check from a DIFFERENT app is judged separately" "$READY" 'checks did not pass on 01234567: Scan'

# --- Legacy commit statuses: failure/error block, pending does not.
fixtures clean "$RESOLVED" "$GREEN"
printf '%s\n' '{"statuses":[{"context":"review-board","state":"pending"},{"context":"Vercel","state":"success"}]}' > "$FAKE/status.json"
expect_allow "a pending commit status (review-board before its PASS) does not block" "$READY"
for s in failure error; do
  fixtures clean "$RESOLVED" "$GREEN"
  printf '{"statuses":[{"context":"Vercel","state":"%s"}]}\n' "$s" > "$FAKE/status.json"
  expect_block "a commit status in $s blocks, naming it" "$READY" "commit statuses not passing on 01234567: Vercel ($s)"
done
fixtures clean "$RESOLVED" "$GREEN"
rm -f "$FAKE/status.json"
expect_block "commit statuses unreadable blocks" "$READY" 'cannot read the commit statuses'
fixtures clean "$RESOLVED" "$GREEN"
printf '%s\n' '{"statuses":[{"context":"review-board","state":"pending"},{"context":"Vercel","state":"pending"}]}' > "$FAKE/status.json"
expect_block "a pending status other than review-board blocks (#10329 review)" "$READY" 'commit statuses not passing on 01234567: Vercel (pending)'

# --- Each statement is read on its own (#10329 review).
fixtures clean "$OPEN" "$GREEN"
expect_block "an --undo in one statement does not hide a ready call in the next" 'gh pr ready 12 --undo; gh pr ready 10305' 'unresolved review threads'
expect_block "...nor in the previous one" 'gh pr ready 10305 && gh pr ready 12 --undo' 'unresolved review threads'
expect_allow "gh pr ready --undo with the number after the flag is still not a ready call" 'gh pr ready --undo 10305'
# The repository each call names is the one checked.
for c in 'gh pr ready 34 --repo other/project' 'gh pr ready -R other/project 34' 'gh pr ready --repo=other/project 34' 'gh pr ready https://github.com/other/project/pull/34'; do
  fixtures clean "$RESOLVED" "$GREEN"
  run_hook "$c"
  if [ "$RC" -eq 0 ] && grep -qx 'repos/other/project/pulls/34' "$FAKE/calls.log" \
    && ! grep -q 'Tristan578/project-forge' "$FAKE/calls.log"; then
    ok "'$c' is checked against other/project, not the origin"
  else
    bad "'$c' (rc=$RC) asked for: $(tr '\n' ' ' < "$FAKE/calls.log")"
  fi
done
fixtures clean "$RESOLVED" "$GREEN"
run_hook 'gh pr ready 1 -R a/one; gh pr ready 2 -R b/two'
if [ "$RC" -eq 0 ] && grep -qx 'repos/a/one/pulls/1' "$FAKE/calls.log" && grep -qx 'repos/b/two/pulls/2' "$FAKE/calls.log" \
  && ! grep -qE 'repos/(a/one/pulls/2|b/two/pulls/1)$' "$FAKE/calls.log"; then
  ok "two ready calls each check their own repository"
else
  bad "two ready calls, two repos (rc=$RC): $(tr '\n' ' ' < "$FAKE/calls.log")"
fi

# --- Pagination: a failure on the SECOND page of check runs still blocks.
fixtures clean "$RESOLVED" "$GREEN"
printf '%s\n%s\n' "$GREEN" '{"check_runs":[{"name":"Late","status":"completed","conclusion":"failure"}]}' > "$FAKE/checks.json"
expect_block "a failure on a later check-run page blocks" "$READY" 'checks did not pass on 01234567: Late'

# --- The GraphQL fallback (a local session, where ccr/review_threads is absent).
GQ_OPEN='{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[{"isResolved":true,"path":"a.ts","line":1,"comments":{"nodes":[{"databaseId":5}]}},{"isResolved":false,"path":"c.ts","line":9,"comments":{"nodes":[{"databaseId":77}]}}]}}}}}'
GQ_CLEAN='{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[{"isResolved":true,"path":"a.ts","line":1,"comments":{"nodes":[{"databaseId":5}]}}]}}}}}'
GQ_MORE='{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":true},"nodes":[]}}}}}'
fixtures clean - "$GREEN" "$GQ_CLEAN"
expect_allow "GraphQL fallback: all threads resolved" "$READY"
fixtures clean - "$GREEN" "$GQ_OPEN"
expect_block "GraphQL fallback: an unresolved thread blocks, naming it" "$READY" 'unresolved review threads: c.ts:9 (comment 77)'
fixtures clean - "$GREEN" "$GQ_MORE"
expect_block "GraphQL fallback: more than one page of threads blocks" "$READY" 'more than 100 review threads'
fixtures clean - "$GREEN" '{"errors":[{"message":"nope"}]}'
expect_block "GraphQL fallback: an answer with no thread list blocks" "$READY" 'no thread list'
fixtures clean '{"message":"No such route"}' "$GREEN" "$GQ_OPEN"
expect_block "a non-array ccr answer falls back to GraphQL" "$READY" 'unresolved review threads: c.ts:9'

# --- Fail closed: a fact that cannot be read blocks.
fixtures clean - "$GREEN"
expect_block "threads unreadable by either route blocks" "$READY" 'cannot read its review threads'
fixtures clean "$RESOLVED" -
expect_block "check runs unreadable blocks" "$READY" 'cannot read the check runs'
fixtures clean "$RESOLVED" 'not json'
expect_block "a check-run answer that is not JSON blocks" "$READY" 'was not JSON'
rm -f "$FAKE"/*.json
expect_block "the PR itself unreadable blocks" "$READY" 'cannot read PR #10305'
printf '{"head":{},"mergeable_state":"clean"}\n' > "$FAKE/pr.json"
expect_block "a PR answer with no head commit blocks" "$READY" 'no head commit'
fixtures clean "$RESOLVED" "$GREEN"
expect_block "gh pr ready with no number blocks" 'gh pr ready' 'without a PR number'
expect_block "gh pr ready with only flags blocks" 'gh pr ready --repo x/y' 'without a PR number'

# --- Several PRs in one command: each is checked; one bad one blocks.
fixtures clean "$OPEN" "$GREEN"
expect_block "two ready calls in one command: the bad one blocks" \
  'gh pr ready 1; gh api -X POST repos/Tristan578/project-forge/pulls/10305/ccr/ready_for_review' 'unresolved review threads'

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "SUITE PASSED"
