#!/usr/bin/env bash
# Tests for .claude/hooks/require-pr-ready.sh (#10328).
#
# The hook calls `gh`. These tests put a fake `gh` FIRST ON PATH that answers
# from fixture files in $FAKE, so the hook itself carries no test seam (there
# is no override variable for CI to wire). The fake fails any route it was not
# given a fixture for, which is how the fail-closed paths are driven.
# REQUIRE_PR_READY_BUDGET_SECONDS is the hook's operator knob, not a test seam;
# the time-budget case below shortens it rather than waiting 25 s.
set -uo pipefail
# A GH_REPO in the caller's environment would change which repository every
# case is checked against.
unset GH_REPO

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
# In GitHub Actions a failure is also an annotation, so the failing case is
# named on the check run even when the job log is too long to read in full.
bad() {
  echo "  FAIL  $1"; FAIL=$((FAIL + 1))
  [ "${GITHUB_ACTIONS:-}" != true ] || echo "::error title=require-pr-ready.test.sh::${1%%$'\n'*}"
}
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
[ ! -f "$FAKE_DIR/sleep" ] || sleep "$(cat "$FAKE_DIR/sleep")"
case "$route" in
  graphql) f=graphql.json ;;
  repos/*/pulls/*/ccr/review_threads) f=threads.json ;;
  repos/*/commits/*/check-runs*) f=checks.json ;;
  repos/*/commits/*/status*) f=status.json ;;
  repos/*/pulls/*) f=pr.json ;;
  *) exit 1 ;;
esac
[ ! -f "$FAKE_DIR/sleep.$f" ] || sleep "$(cat "$FAKE_DIR/sleep.$f")"
[ -f "$FAKE_DIR/$f" ] || exit 1
cat "$FAKE_DIR/$f"
FAKEGH
chmod +x "$TMP/bin/gh"

# fixtures <mergeable_state> <threads-json|-> <checks-json|-> [graphql-json]
# Writes a fresh fixture set; "-" leaves that route unanswered.
fixtures() {
  rm -f "$FAKE"/*.json "$FAKE/sleep" "$FAKE"/sleep.*
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
# MSYS_NO_PATHCONV / MSYS2_ARG_CONV_EXCL: under Git Bash on Windows, jq is a
# native .exe and the MSYS runtime rewrites an argument that starts with / as
# a Windows path ('/usr/bin/gh ...' -> 'C:/Program Files/Git/usr/bin/gh ...'),
# so the command under test would not reach the hook verbatim. No-op elsewhere.
run_hook() {
  OUT=$(MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' jq -nc --arg c "$1" '{tool_input:{command:$c}}' \
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
# run_mcp <tool name> <tool_input JSON> — the hook as Claude Code runs it for an MCP tool.
run_mcp() {
  OUT=$(jq -nc --arg t "$1" --argjson i "$2" '{tool_name:$t, tool_input:$i}' \
    | (cd "$HERE" && PATH="$TMP/bin:$PATH" FAKE_DIR="$FAKE" bash "$HOOK" 2>&1))
  RC=$?
}
readonly -f run_mcp
expect_mcp() { # <label> <want rc> <tool> <input JSON> [stderr substring]
  run_mcp "$3" "$4"
  if [ "$RC" -eq "$2" ] && { [ -z "${5:-}" ] || grep -qF -- "$5" <<<"$OUT"; }; then ok "$1"; else bad "$1 (rc=$RC): $OUT"; fi
}
readonly -f expect_mcp

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
# Unquoted, `#10305` starts a shell comment, so gh is called with NO number.
expect_block "gh pr ready #<n> is a ready call with no number (the # starts a comment)" 'gh pr ready #10305' 'without a PR number'
expect_allow "gh pr ready '#<n>' (quoted) names the PR" "gh pr ready '#10305'"
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
expect_block "the PR itself unreadable blocks" "$READY" 'cannot read PR Tristan578/project-forge#10305'
printf '{"head":{},"mergeable_state":"clean"}\n' > "$FAKE/pr.json"
expect_block "a PR answer with no head commit blocks" "$READY" 'no head commit'
fixtures clean "$RESOLVED" "$GREEN"
expect_block "gh pr ready with no number blocks" 'gh pr ready' 'without a PR number'
expect_block "gh pr ready with only flags blocks" 'gh pr ready --repo x/y' 'without a PR number'

# --- Round-1 board (#10329): commands that only MENTION a ready call are not one.
fixtures clean "$OPEN" "$GREEN"
expect_allow "a commit message that mentions gh pr ready" 'git commit -m "docs: gh pr ready is now gated"'
expect_allow "a ; inside a quoted message does not split the statement" 'git commit -m "x; gh pr ready 10305"'
expect_allow "...nor inside single quotes" "git commit -m 'x; gh pr ready 10305'"
expect_allow "echo of the words" 'echo gh pr ready 10305'
expect_allow "a commit message that mentions a board PASS" 'git commit -m "fix: post-board-verdict.sh 10305 PASS now gated"'
expect_allow "a grep for a board PASS" "grep -n 'post-board-verdict.sh 10305 PASS' notes.md"
expect_allow "a heredoc commit message is not read as commands" $'git commit -F - <<\'EOF\'\nfix: gate\n\ngh pr ready 10305\nEOF'
expect_allow "a comment with no PASS marker" 'gh pr comment 10305 --body "thanks"'
expect_allow "a cat-heredoc comment body with no PASS marker" $'gh pr comment 10305 --body "$(cat <<\'EOF\'\nstanding down: CI red\nEOF\n)"'
expect_allow "a stdin comment with no PASS marker" $'gh pr comment 10305 --body-file - <<\'EOF\'\nstanding down: CI red\nEOF'

# --- Round-1 board (#10329): wrapped and alternative spellings ARE ready calls.
# shellcheck disable=SC2016  # the $ is the point: these are commands the hook reads, not expansions
for c in 'bash -c "gh pr ready 10305"' "sh -c 'gh pr ready 10305'" 'bash -lc "cd x && gh pr ready 10305"' \
  '(gh pr ready 10305)' 'echo $(gh pr ready 10305)' 'echo "$(gh pr ready 10305)"' 'echo `gh pr ready 10305`' \
  '/usr/bin/gh pr ready 10305' 'eval "gh pr ready 10305"' 'FOO=1 gh pr ready 10305' \
  'bash scripts/post-board-verdict.sh "10305" PASS abc 5/5 ok' 'bash scripts/post-board-verdict.sh 10305 "PASS" abc 5/5 ok' \
  'gh pr comment 10305 --body "<!-- board-verdict: PASS sha=abc seats=5/5 -->"' \
  'gh issue comment 10305 -b "board-verdict: PASS"' \
  "gh pr comment 10305 --body-file $TMP/verdict.md" \
  $'gh pr comment 10305 --body-file - <<\'EOF\'\n<!-- board-verdict: PASS sha=abc seats=5/5 -->\nEOF' \
  "gh api repos/Tristan578/project-forge/issues/10305/comments --input $TMP/verdict.md" \
  'gh api repos/Tristan578/project-forge/issues/10305/comments -f "body=<!-- board-verdict: PASS -->"' \
  "gh api repos/Tristan578/project-forge/issues/10305/comments -fbody='board-verdict: PASS'" \
  "gh api -X POST 'repos/{owner}/{repo}/pulls/10305/ccr/ready_for_review'" \
  $'gh pr comment 10305 --body "$(cat <<\'EOF\'\n<!-- board-verdict: PASS sha=abc seats=5/5 -->\nEOF\n)"' \
  $'gh api repos/Tristan578/project-forge/issues/10305/comments -f body="$(cat <<EOF\nboard-verdict: PASS\nEOF\n)"' \
  'BODY="<!-- board-verdict: PASS -->"; gh pr comment 10305 --body "$BODY"' \
  'timeout 30 gh pr ready 10305' 'timeout -s KILL 30 gh pr ready 10305' \
  'env -u FOO gh pr ready 10305' 'env -C /tmp gh pr ready 10305' "env -S 'gh pr ready 10305'" \
  'sudo -u root gh pr ready 10305' 'nice -n 5 gh pr ready 10305' 'time -f %e gh pr ready 10305' \
  'stdbuf -o L gh pr ready 10305' 'env -- gh pr ready 10305' 'env -i FOO=1 gh pr ready 10305'; do
  fixtures clean "$OPEN" "$GREEN"
  expect_block "is a ready call: $c" "$c" 'unresolved review threads'
done
# A PR that cannot be read from the call blocks, whatever the trigger.
fixtures clean "$RESOLVED" "$GREEN"
# shellcheck disable=SC2016  # the $ is the point: these are commands the hook reads, not expansions
for c in 'for pr in 10304 10305; do gh api -X POST repos/Tristan578/project-forge/pulls/$pr/ccr/ready_for_review; done' \
  'PR=10305; bash scripts/post-board-verdict.sh $PR PASS abc 5/5 ok' \
  'bash scripts/post-board-verdict.sh 10305 $VERDICT abc 5/5 ok' \
  "gh api graphql -f query='mutation { markPullRequestReadyForReview(input:{pullRequestId:\"X\"}) { clientMutationId } }'" \
  'gh pr comment --body "board-verdict: PASS"' \
  'echo 10305 | xargs gh pr ready' 'xargs -n 1 gh pr ready < prs.txt'; do
  expect_block "an unreadable PR blocks: $c" "$c" 'without a PR number'
done
# A GH_REPO= prefix names the repository.
fixtures clean "$RESOLVED" "$GREEN"
run_hook 'GH_REPO=other/project gh pr ready 34'
if [ "$RC" -eq 0 ] && grep -qx 'repos/other/project/pulls/34' "$FAKE/calls.log"; then
  ok "a GH_REPO= prefix is the repository checked"
else
  bad "GH_REPO= prefix (rc=$RC) asked for: $(tr '\n' ' ' < "$FAKE/calls.log")"
fi
# post-board-verdict.sh posts to ${GH_REPO:-Tristan578/project-forge}, so a
# GH_REPO= prefix names the repository its PASS is checked against (#10329 Sentry).
fixtures clean "$RESOLVED" "$GREEN"
run_hook 'GH_REPO=other/project bash scripts/post-board-verdict.sh 34 PASS abc 5/5 ok'
if [ "$RC" -eq 0 ] && grep -qx 'repos/other/project/pulls/34' "$FAKE/calls.log" && ! grep -q 'Tristan578/project-forge' "$FAKE/calls.log"; then
  ok "a GH_REPO= prefix on post-board-verdict.sh is the repository checked"
else
  bad "GH_REPO= on post-board-verdict.sh (rc=$RC) asked for: $(tr '\n' ' ' < "$FAKE/calls.log")"
fi
# gh api fills {owner}/{repo} from GH_REPO, so that is the repository checked (#10329 Sentry).
fixtures clean "$RESOLVED" "$GREEN"
run_hook "GH_REPO=other/project gh api -X POST 'repos/{owner}/{repo}/pulls/34/ccr/ready_for_review'"
if [ "$RC" -eq 0 ] && grep -qx 'repos/other/project/pulls/34' "$FAKE/calls.log" && ! grep -q 'Tristan578/project-forge' "$FAKE/calls.log"; then
  ok "a {owner}/{repo} route under GH_REPO is checked against GH_REPO"
else
  bad "{owner}/{repo} under GH_REPO (rc=$RC) asked for: $(tr '\n' ' ' < "$FAKE/calls.log")"
fi
# An empty GH_REPO= is unset to gh, so the call is checked against origin (#10329 board).
fixtures clean "$RESOLVED" "$GREEN"
run_hook "GH_REPO= gh api -X POST 'repos/{owner}/{repo}/pulls/34/ccr/ready_for_review'"
if [ "$RC" -eq 0 ] && grep -qx 'repos/Tristan578/project-forge/pulls/34' "$FAKE/calls.log"; then
  ok "an empty GH_REPO= prefix falls back to origin"
else
  bad "empty GH_REPO= prefix (rc=$RC) asked for: $(tr '\n' ' ' < "$FAKE/calls.log")"
fi
# A ready route the hook cannot parse blocks rather than passing.
fixtures clean "$RESOLVED" "$GREEN"
expect_block "an unparseable ready route blocks" 'gh api -X POST repos//pulls/34/ccr/ready_for_review' 'without a PR number'
# The block message names the statement it matched.
fixtures clean "$OPEN" "$GREEN"
expect_block "the message names the matched call" 'true && bash -c "gh pr ready 10305"' 'Matched: gh pr ready 10305'

# --- Mergeability arms: a draft PR is the normal state here; null is unknown.
fixtures draft "$RESOLVED" "$GREEN"
expect_allow "mergeable_state draft is not a conflict" "$READY"
fixtures clean "$RESOLVED" "$GREEN"
printf '{"head":{"sha":"%s"},"mergeable_state":null}\n' "$HEAD_SHA" > "$FAKE/pr.json"
expect_block "a null mergeable_state blocks as still computing" "$READY" 'not finished computing mergeability'
# --- More commit statuses than one page blocks.
fixtures clean "$RESOLVED" "$GREEN"
printf '%s\n' '{"total_count":101,"statuses":[{"context":"Vercel","state":"success"}]}' > "$FAKE/status.json"
expect_block "more statuses than were read blocks" "$READY" 'more than 100 commit statuses'

# --- The hook is wired: exactly one Bash PreToolUse entry runs it.
SETTINGS="$HERE/../../settings.json"
wired=$(jq '[.hooks.PreToolUse[] | select(.matcher == "Bash") | .hooks[] | select((.command // "") | test("/\\.claude/hooks/require-pr-ready\\.sh"))] | length' "$SETTINGS" 2>/dev/null)
if [ "$wired" = 1 ]; then ok "settings.json runs the hook on every Bash call"; else bad "settings.json wiring count is '$wired', want 1"; fi
# ...and once more for the GitHub MCP tools that mark ready or post a comment (#10330).
mcp_matcher=$(jq -r '[.hooks.PreToolUse[] | select(.hooks[]? | (.command // "") | test("/\\.claude/hooks/require-pr-ready\\.sh")) | .matcher | select(. != "Bash")] | .[0] // ""' "$SETTINGS" 2>/dev/null)
# The GitHub server can be installed under another name (a plugin's is
# mcp__plugin_github_github__...); the hook reads only the part after the last __.
for server in github plugin_github_github; do
  for tool in update_pull_request add_issue_comment update_issue_comment; do
    if [ -n "$mcp_matcher" ] && grep -qE "^(${mcp_matcher})\$" <<<"mcp__${server}__$tool"; then
      ok "settings.json runs the hook on mcp__${server}__$tool"
    else
      bad "settings.json MCP matcher '$mcp_matcher' does not match mcp__${server}__$tool"
    fi
  done
done
fixtures clean "$OPEN" "$GREEN"
expect_mcp "MCP update_pull_request under a plugin server name is a ready call" 2 mcp__plugin_github_github__update_pull_request \
  '{"owner":"Tristan578","repo":"project-forge","pullNumber":10305,"draft":false}' 'unresolved review threads' 
if [ -n "$mcp_matcher" ] && ! grep -qE "^(${mcp_matcher})\$" <<<"mcp__github__get_pull_request" \
  && ! grep -qE "^(${mcp_matcher})\$" <<<"mcp__github__update_pull_request_branch"; then
  ok "...and not on a read-only GitHub MCP tool"
else
  bad "MCP matcher '$mcp_matcher' also matches mcp__github__get_pull_request"
fi

# --- #10330: the GitHub MCP tools.
fixtures clean "$OPEN" "$GREEN"
expect_mcp "MCP update_pull_request draft:false is a ready call" 2 mcp__github__update_pull_request \
  '{"owner":"Tristan578","repo":"project-forge","pullNumber":10305,"draft":false}' 'unresolved review threads'
expect_mcp "MCP update_pull_request with pull_number (snake case)" 2 mcp__github__update_pull_request \
  '{"owner":"Tristan578","repo":"project-forge","pull_number":10305,"draft":false}' 'unresolved review threads'
expect_mcp "MCP add_issue_comment with issueNumber (camel case)" 2 mcp__github__add_issue_comment \
  '{"owner":"Tristan578","repo":"project-forge","issueNumber":10305,"body":"board-verdict: PASS"}' 'unresolved review threads'
expect_mcp "MCP update_pull_request draft:true is not" 0 mcp__github__update_pull_request \
  '{"owner":"Tristan578","repo":"project-forge","pullNumber":10305,"draft":true}'
expect_mcp "MCP update_pull_request without draft (a title edit) is not" 0 mcp__github__update_pull_request \
  '{"owner":"Tristan578","repo":"project-forge","pullNumber":10305,"title":"x"}'
expect_mcp "MCP add_issue_comment carrying a PASS marker is a ready call" 2 mcp__github__add_issue_comment \
  '{"owner":"Tristan578","repo":"project-forge","issue_number":10305,"body":"<!-- board-verdict: PASS sha=abc seats=5/5 -->"}' 'unresolved review threads'
expect_mcp "MCP add_issue_comment without a marker is not" 0 mcp__github__add_issue_comment \
  '{"owner":"Tristan578","repo":"project-forge","issue_number":10305,"body":"standing down: CI red"}'
expect_mcp "MCP update_issue_comment carrying a marker blocks (no PR number), saying how to post it" 2 mcp__github__update_issue_comment \
  '{"owner":"Tristan578","repo":"project-forge","comment_id":5,"body":"board-verdict: PASS"}' 'Post the PASS as a new comment'
expect_mcp "MCP call without owner/repo names the missing arguments" 2 mcp__github__update_pull_request \
  '{"pullNumber":10305,"draft":false}' 'Pass owner and repo to the tool'
expect_mcp "MCP update_pull_request draft:false with no number blocks" 2 mcp__github__update_pull_request \
  '{"owner":"Tristan578","repo":"project-forge","draft":false}' 'without a PR number'
fixtures clean "$RESOLVED" "$GREEN"
run_mcp mcp__github__update_pull_request '{"owner":"other","repo":"project","pullNumber":34,"draft":false}'
if [ "$RC" -eq 0 ] && grep -qx 'repos/other/project/pulls/34' "$FAKE/calls.log" && ! grep -q 'Tristan578/project-forge' "$FAKE/calls.log"; then
  ok "an MCP call is checked against the repository it names"
else
  bad "MCP repository (rc=$RC) asked for: $(tr '\n' ' ' < "$FAKE/calls.log")"
fi

# --- #10330: the hook stops itself before the harness's own timeout lets the call through.
fixtures clean "$RESOLVED" "$GREEN"
printf '3\n' > "$FAKE/sleep"
OUT=$(jq -nc --arg c 'gh pr ready 10305' '{tool_input:{command:$c}}' \
  | (cd "$HERE" && PATH="$TMP/bin:$PATH" FAKE_DIR="$FAKE" REQUIRE_PR_READY_BUDGET_SECONDS=2 bash "$HOOK" 2>&1)); RC=$?
if [ "$RC" -eq 2 ] && grep -qF 'ran out of time' <<<"$OUT"; then ok "a slow GitHub blocks once the budget is spent"; else bad "time budget (rc=$RC): $OUT"; fi
fixtures clean "$RESOLVED" "$GREEN"
OUT=$(jq -nc --arg c 'gh pr ready 10305' '{tool_input:{command:$c}}' \
  | (cd "$HERE" && PATH="$TMP/bin:$PATH" FAKE_DIR="$FAKE" REQUIRE_PR_READY_BUDGET_SECONDS=08 bash "$HOOK" 2>&1)); RC=$?
if [ "$RC" -eq 0 ]; then ok "a budget of 08 is read as base 10, not an octal error"; else bad "budget 08 (rc=$RC): $OUT"; fi
# A gh that hangs is CUT OFF at the budget, not waited out: the harness's own
# 30 s timeout would otherwise let the call through. Needs a coreutils timeout,
# which is what the hook uses; without one the cut-off does not exist to test.
if timeout 5 true </dev/null >/dev/null 2>&1; then
  fixtures clean "$RESOLVED" "$GREEN"
  printf '20\n' > "$FAKE/sleep"
  START=$SECONDS
  OUT=$(jq -nc --arg c 'gh pr ready 10305' '{tool_input:{command:$c}}' \
    | (cd "$HERE" && PATH="$TMP/bin:$PATH" FAKE_DIR="$FAKE" REQUIRE_PR_READY_BUDGET_SECONDS=2 bash "$HOOK" 2>&1)); RC=$?
  ELAPSED=$((SECONDS - START))
  if [ "$RC" -eq 2 ] && grep -qF 'ran out of time' <<<"$OUT" && [ "$ELAPSED" -le 6 ]; then
    ok "a hanging gh is cut off at the budget (${ELAPSED}s)"
  else
    bad "hanging gh (rc=$RC, ${ELAPSED}s): $OUT"
  fi
else
  echo "  note  no coreutils timeout here: the per-call cut-off is not used, so it is not tested"
fi
# Without a working timeout, the LAST answer can arrive after the budget; it must
# not authorise the call (Devin review on #10333). A failing `timeout` stands in
# for a host without one, the way System32's timeout.exe would.
mkdir -p "$TMP/notimeout"; printf '#!/bin/sh\nexit 1\n' > "$TMP/notimeout/timeout"; chmod +x "$TMP/notimeout/timeout"
fixtures clean "$RESOLVED" "$GREEN"
printf '3\n' > "$FAKE/sleep.status.json"
OUT=$(jq -nc --arg c 'gh pr ready 10305' '{tool_input:{command:$c}}' \
  | (cd "$HERE" && PATH="$TMP/notimeout:$TMP/bin:$PATH" FAKE_DIR="$FAKE" REQUIRE_PR_READY_BUDGET_SECONDS=2 bash "$HOOK" 2>&1)); RC=$?
if [ "$RC" -eq 2 ] && grep -qF 'ran out of time' <<<"$OUT"; then ok "a late last answer (no timeout) does not authorise the call"; else bad "late last answer (rc=$RC): $OUT"; fi

# --- #10330: a script a shell reads from stdin.
fixtures clean "$RESOLVED" "$GREEN"
expect_block "a heredoc fed to bash that names a ready call blocks" $'bash <<\'EOF\'\ngh pr ready 10305\nEOF' 'Run the ready call as a plain command'
expect_block "...and a pipe into sh" "printf 'gh pr ready 10305' | sh" 'a script fed to a shell on stdin'
expect_block "...and bash -s with arguments" $'bash -s -- 5 <<\'EOF\'\ngh pr ready 10305\nEOF' 'a script fed to a shell on stdin'
fixtures clean "$OPEN" "$GREEN"
for c in 'bash <<< "gh pr ready 10305"' "bash <<<'gh pr ready 10305'" 'zsh <<< "gh pr ready 10305"; echo done' \
  'bash -o pipefail -c "gh pr ready 10305"' '/usr/bin/env gh pr ready 10305'; do
  expect_block "is a ready call: $c" "$c" 'unresolved review threads'
done
expect_allow "a here-string with no ready call is allowed" 'bash <<< "echo hi"'
# #10334: the stdin script comes from its own segment (its pipe or heredoc);
# a ready call named in ANOTHER segment is not that script.
fixtures clean "$OPEN" "$GREEN"
expect_allow "a ready call named in another statement does not make a stdin script one" \
  "git commit -m 'document gh pr ready'; printf 'echo ok\\n' | bash"
for c in "git commit -m 'document gh pr ready' && printf 'echo ok' | bash" "grep -q 'gh pr ready' notes.md || printf 'echo ok' | bash"; do
  expect_allow "a list operator also separates the stdin script: $c" "$c"
done
expect_block "...but a 2>&1 redirect does not split a pipe" "printf 'gh pr ready 10305' 2>&1 | bash" 'a script fed to a shell on stdin'
expect_allow "...nor one after it" $'bash <<\'EOF\'\necho ok\nEOF\ngit commit -m \'document gh pr ready\''
# shellcheck disable=SC2016  # the $ is the point: the command the hook reads
expect_block "a variable fed to a shell can carry a ready call from elsewhere" \
  'X="gh pr ready 10305"; echo "$X" | bash' 'a script fed to a shell on stdin'
expect_allow "a here-string to a non-shell is not a call" 'grep -c x <<< "gh pr ready 10305"'
# gh is in the text so the hook's cheap early exit cannot answer for the stdin branch.
expect_allow "a heredoc fed to bash that names no ready call is allowed" $'bash <<\'EOF\'\ngh pr view 10305\nEOF'
# shellcheck disable=SC2016  # the $ is the point: these are commands the hook reads, not expansions
for c in $'bash <<\'EOF\'\ngh api -X POST repos/o/r/pulls/5/ccr/ready_for_review\nEOF' \
  $'bash <<\'EOF\'\nbash scripts/post-board-verdict.sh 5 PASS abc 5/5 ok\nEOF' \
  $'bash <<\'EOF\'\ngh api graphql -f query=\'mutation{markPullRequestReadyForReview(input:{pullRequestId:"x"}){clientMutationId}}\'\nEOF' \
  $'bash <<\'EOF\'\ngh pr comment 5 --body "board-verdict: PASS"\nEOF'; do
  l=${c#*$'\n'}; l=${l%%$'\n'*}
  expect_block "a stdin script naming a ready call blocks: $l" "$c" 'a script fed to a shell on stdin'
done

# --- #10330: a marker read from a file the command names.
printf '<!-- board-verdict: PASS sha=abc seats=5/5 -->\n' > "$TMP/v.md"
printf 'standing down: CI red\n' > "$TMP/plain.md"
for c in "gh pr comment 10305 --body \"\$(cat $TMP/v.md)\"" "gh pr comment 10305 -F - < $TMP/v.md" \
  "cat $TMP/v.md | gh pr comment 10305 -F -"; do
  fixtures clean "$OPEN" "$GREEN"
  expect_block "a marker in a file the command reads: $c" "$c" 'unresolved review threads'
done
# A quoted path with a space is one path (Devin review on #10333).
printf '<!-- board-verdict: PASS sha=abc seats=5/5 -->\n' > "$TMP/board verdict.md"
# (-F <path> is read by the -F handling itself; these three only body_files reads.)
for c in "gh pr comment 10305 --body \"\$(cat '$TMP/board verdict.md')\"" "cat '$TMP/board verdict.md' | gh pr comment 10305 -F -" \
  "gh pr comment 10305 -F - < \"$TMP/board verdict.md\""; do
  fixtures clean "$OPEN" "$GREEN"
  expect_block "a quoted body path with a space is read: $c" "$c" 'unresolved review threads'
done
# ...and keeping a quoted word whole must not hide the reads INSIDE a quoted script.
for c in "bash -c 'gh pr comment 10305 -F - < $TMP/v.md'" "bash -c 'gh pr comment 10305 --body \"\$(cat $TMP/v.md)\"'" \
  "bash -c 'cat $TMP/v.md | gh pr comment 10305 -F -'"; do
  fixtures clean "$OPEN" "$GREEN"
  expect_block "a body file inside a bash -c script is read: $c" "$c" 'unresolved review threads'
done
# #10334: only a cat in command position reads a file; "cat" in prose does not.
fixtures clean "$OPEN" "$GREEN"
expect_allow "the word cat in a reply's prose does not read the file after it" \
  "gh pr comment 10305 --body \"\$(echo hi) run cat $TMP/v.md to see\""
# A ~/ path is read the way the shell would expand it.
HOME_DIR=$(mktemp -d "$TMP/home.XXXXXX"); cp "$TMP/v.md" "$HOME_DIR/v.md"
fixtures clean "$OPEN" "$GREEN"
OUT=$(MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' jq -nc --arg c 'gh pr comment 10305 --body "$(cat ~/v.md)"' '{tool_input:{command:$c}}' \
  | (cd "$HERE" && HOME="$HOME_DIR" PATH="$TMP/bin:$PATH" FAKE_DIR="$FAKE" bash "$HOOK" 2>&1)); RC=$?
if [ "$RC" -eq 2 ] && grep -qF 'unresolved review threads' <<<"$OUT"; then ok "a marker in ~/v.md is read"; else bad "~ body file (rc=$RC): $OUT"; fi
fixtures clean "$OPEN" "$GREEN"
expect_allow "a body read from a file with no marker is not a ready call" "gh pr comment 10305 --body \"\$(cat $TMP/plain.md)\""
# A file the body only NAMES is not read: a reply citing a script that holds the marker text is not a PASS.
for c in $'gh pr comment 10305 --body "$(cat <<\'EOF\'\nFixed: see '"$TMP"$'/v.md\nEOF\n)"' \
  "gh pr comment 10305 -b \"see $TMP/v.md and \$X\"" \
  $'gh api repos/Tristan578/project-forge/pulls/10305/comments/9/replies -f body="$(cat <<\'EOF\'\nsee '"$TMP"$'/v.md\nEOF\n)"'; do
  expect_allow "a body that only names a marker-bearing file is not a PASS: $c" "$c"
done

# --- #10330: wrapper spellings.
# shellcheck disable=SC2016  # the $ is the point: these are commands the hook reads, not expansions
for c in 'timeout 30 env X=1 gh pr ready 10305' "env -S'gh pr ready 10305'" 'env --split-string="gh pr ready 10305"' \
  'sudo -nu root gh pr ready 10305' 'env -iu FOO gh pr ready 10305' 'env -uFOO gh pr ready 10305' \
  'exec -a name gh pr ready 10305' '/usr/bin/timeout 5 gh pr ready 10305' '/usr/bin/sudo gh pr ready 10305'; do
  fixtures clean "$OPEN" "$GREEN"
  expect_block "is a ready call: $c" "$c" 'unresolved review threads'
done
fixtures clean "$OPEN" "$GREEN"
expect_block "xargs --max-args N gh pr ready names no PR" 'echo 1 | xargs --max-args 1 gh pr ready' 'without a PR number'
expect_block "...and by path" 'echo 1 | /usr/bin/xargs gh pr ready' 'without a PR number'
expect_allow "command -v only prints where gh is" 'command -v gh pr ready 10305'
expect_allow "...and command -V" 'command -V gh pr ready 10305'

# --- #10330: variable PRs, the comment URL selector, the thread-list cap, the origin default.
fixtures clean "$RESOLVED" "$GREEN"
# shellcheck disable=SC2016  # the $ is the point: these are commands the hook reads, not expansions
for c in 'gh pr ready $PR' 'gh pr comment $PR --body "board-verdict: PASS"' \
  "gh api repos/Tristan578/project-forge/issues/\$PR/comments -f body='board-verdict: PASS'"; do
  expect_block "a variable PR blocks: $c" "$c" 'without a PR number'
done
fixtures clean "$RESOLVED" "$GREEN"
run_hook 'gh pr comment https://github.com/other/project/pull/34 --body "board-verdict: PASS"'
if [ "$RC" -eq 0 ] && grep -qx 'repos/other/project/pulls/34' "$FAKE/calls.log"; then
  ok "a comment's PR URL names the repository and PR checked"
else
  bad "comment URL selector (rc=$RC) asked for: $(tr '\n' ' ' < "$FAKE/calls.log")"
fi
SEVEN=$(jq -nc '[range(1;8) | {resolved:false, path:"f\(.).ts", line:., comment_ids:[.]}]')
fixtures clean "$SEVEN" "$GREEN"
run_hook "$READY"
if [ "$RC" -eq 2 ] && grep -qF 'f5.ts:5 (comment 5), ... (7 open)' <<<"$OUT" && ! grep -qF 'f6.ts' <<<"$OUT"; then
  ok "the open-thread list names five and counts the rest"
else
  bad "thread-list cap (rc=$RC): $OUT"
fi
fixtures clean "$RESOLVED" "$GREEN"
run_hook 'bash scripts/post-board-verdict.sh 34 PASS abc 5/5 ok'
if [ "$RC" -eq 0 ] && grep -qx 'repos/Tristan578/project-forge/pulls/34' "$FAKE/calls.log"; then
  ok "a board PASS with no GH_REPO is checked against origin"
else
  bad "origin default (rc=$RC) asked for: $(tr '\n' ' ' < "$FAKE/calls.log")"
fi

# --- Several PRs in one command: each is checked; one bad one blocks.
fixtures clean "$OPEN" "$GREEN"
expect_block "two ready calls in one command: the bad one blocks" \
  'gh pr ready 1; gh api -X POST repos/Tristan578/project-forge/pulls/10305/ccr/ready_for_review' 'unresolved review threads'

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "SUITE PASSED"
