#!/usr/bin/env bash
# Unit tests for scripts/preview-db-branch.sh — the preview-database branch
# policy behind the per-PR Vercel preview (#9972, #10015).
#
# WHAT IS UNDER TEST
# ------------------
# Not the Neon API calls — scripts/__tests__/neon-branch.test.sh owns those —
# but the POLICY layered on them: which branch a PR gets, what happens when the
# project's branch allowance is full, and which branches a scheduled sweep may
# delete. Every case exists because the wrong answer deletes a database that is
# in use: another PR's, an in-flight job's, production's.
#
# HERMETIC, TWO SEAMS
# -------------------
# The script never reaches console.neon.tech or api.github.com from here.
#   - Neon: the script shells out to neon-branch.sh, which reads its HTTP
#     client from $NEON_CURL_CMD. The variable is set ONLY on the child
#     invocation, exactly as neon-branch.test.sh does it, and the same
#     unconditional runtime assertion refuses to run if it is set in this
#     suite's own environment. The static scan that keeps the seam out of every
#     workflow lives in neon-branch.test.sh: one seam, one scan.
#   - GitHub: PR state comes from `gh api`, resolved through PATH. The suite
#     puts a stub `gh` first on the CHILD's PATH that replays one fixture per
#     PR number and logs every call. No new environment seam is introduced.
set -uo pipefail

# SIGPIPE-safe matching: feed grep from a here-string or a file, never pipe a
# variable's echo into it (neon-branch.test.sh documents the failure mode).

command -v jq >/dev/null 2>&1 || { echo "jq is required for these tests"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../preview-db-branch.sh"
NEON_HELPER="$HERE/../neon-branch.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
CLEANUP_YML="$REPO_ROOT/.github/workflows/preview-db-cleanup.yml"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "script not found: $SCRIPT"; exit 1; }
[ -f "$NEON_HELPER" ] || { echo "neon-branch.sh not found next to the script"; exit 1; }

# RUNTIME ANTI-TAMPER — same contract as neon-branch.test.sh, for the same
# reason: if the seam is set in this environment, the hermetic guarantee is gone.
if [ -n "${NEON_CURL_CMD:-}" ]; then
  echo "  FAIL: runtime: NEON_CURL_CMD must never be set outside this suite's own child invocations (out-of-tree tampering detected)"
  echo "1 test(s) failed."
  exit 1
fi

TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T"' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# --- Neon stub: the shape neon-branch.sh calls curl in --------------------------
#   curl -sS -X <METHOD> <URL> -H ... -o <BODYFILE> -w '%{http_code}' [--data <JSON>]
# Replays $STUB_DIR/body.<n> + status.<n> for the n-th call across the WHOLE
# child run — neon-branch.sh is invoked several times per subcommand and the
# log is shared, so n keeps counting — falling back to body.default /
# status.default. Headers are never logged: one of them carries the API key.
STUB="$TMPDIR_T/curl-stub.sh"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
set -uo pipefail
method=""; url=""; out=""; data=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="${2:-}"; shift 2 ;;
    -o) out="${2:-}"; shift 2 ;;
    -w) shift 2 ;;
    -H) shift 2 ;;
    --data) data="${2:-}"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf '%s %s %s\n' "$method" "$url" "$data" >> "$STUB_LOG"
n="$(wc -l < "$STUB_LOG" | tr -d ' ')"
body="$STUB_DIR/body.$n"; [ -f "$body" ] || body="$STUB_DIR/body.default"
stat="$STUB_DIR/status.$n"; [ -f "$stat" ] || stat="$STUB_DIR/status.default"
[ -n "$out" ] && [ -f "$body" ] && cat "$body" > "$out"
cat "$stat"
STUBEOF
chmod +x "$STUB"

stub_reset() {
  rm -rf "$TMPDIR_T/stub"
  mkdir -p "$TMPDIR_T/stub"
  : > "$TMPDIR_T/stub.log"
  printf '{}' > "$TMPDIR_T/stub/body.default"
  printf '200' > "$TMPDIR_T/stub/status.default"
}
stub_body()    { cat > "$TMPDIR_T/stub/body.$1"; }
stub_status()  { printf '%s' "$2" > "$TMPDIR_T/stub/status.$1"; }
stub_default() { cat > "$TMPDIR_T/stub/body.default"; }
# Branch ids that were DELETEd, one per line, in request order.
deletes() { sed -nE 's#^DELETE .*/branches/([^ ]+).*$#\1#p' "$TMPDIR_T/stub.log"; }
# How many create attempts reached Neon.
posts()   { grep -c '^POST ' "$TMPDIR_T/stub.log" || true; }

# --- gh stub: `gh api repos/<owner>/<repo>/pulls/<n> --jq .state` ---------------
# Replays $GH_STUB_DIR/pr.<n> (its content is the state) and appends the call
# to $GH_STUB_LOG. A PR with no fixture answers like a 404: exit 1, nothing on
# stdout. The token is never read, so it can never be logged.
mkdir -p "$TMPDIR_T/bin"
cat > "$TMPDIR_T/bin/gh" <<'GHEOF'
#!/usr/bin/env bash
set -uo pipefail
printf '%s\n' "$*" >> "$GH_STUB_LOG"
n="$(printf '%s\n' "$*" | sed -nE 's#.*/pulls/([0-9]+).*#\1#p' | head -1)"
[ -n "$n" ] && [ -f "$GH_STUB_DIR/pr.$n" ] || exit 1
cat "$GH_STUB_DIR/pr.$n"
GHEOF
chmod +x "$TMPDIR_T/bin/gh"

gh_reset() { rm -rf "$TMPDIR_T/gh"; mkdir -p "$TMPDIR_T/gh"; : > "$TMPDIR_T/gh.log"; }
gh_pr()    { printf '%s' "$2" > "$TMPDIR_T/gh/pr.$1"; }
gh_calls() { cat "$TMPDIR_T/gh.log"; }

# Run the script against both stubs; echo "<exit>|<output>". Every seam is set
# on the child only. Leading VAR=value arguments override on the child too.
run_script() {
  local envs=()
  while [ $# -gt 0 ] && [ "${1#*=}" != "$1" ]; do envs+=("$1"); shift; done
  local out rc
  out="$(NEON_CURL_CMD="$STUB" STUB_DIR="$TMPDIR_T/stub" STUB_LOG="$TMPDIR_T/stub.log" \
         NEON_API_KEY='test-key-not-real' NEON_PROJECT_ID='proj-test' \
         GH_TOKEN='test-token-not-real' GITHUB_REPOSITORY='acme/widgets' \
         GH_STUB_DIR="$TMPDIR_T/gh" GH_STUB_LOG="$TMPDIR_T/gh.log" \
         PATH="$TMPDIR_T/bin:$PATH" \
         env ${envs[@]+"${envs[@]}"} bash "$SCRIPT" "$@" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

# Same, with stderr kept APART in $TMPDIR_T/stderr.log — for the output-channel
# case, which is the only one that must tell the two streams apart.
run_script_split() {
  local envs=()
  while [ $# -gt 0 ] && [ "${1#*=}" != "$1" ]; do envs+=("$1"); shift; done
  local out rc
  out="$(NEON_CURL_CMD="$STUB" STUB_DIR="$TMPDIR_T/stub" STUB_LOG="$TMPDIR_T/stub.log" \
         NEON_API_KEY='test-key-not-real' NEON_PROJECT_ID='proj-test' \
         GH_TOKEN='test-token-not-real' GITHUB_REPOSITORY='acme/widgets' \
         GH_STUB_DIR="$TMPDIR_T/gh" GH_STUB_LOG="$TMPDIR_T/gh.log" \
         PATH="$TMPDIR_T/bin:$PATH" \
         env ${envs[@]+"${envs[@]}"} bash "$SCRIPT" "$@" 2>"$TMPDIR_T/stderr.log")"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}
stderr_log() { cat "$TMPDIR_T/stderr.log"; }

NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CREATE_OK='{"branch":{"id":"br-new-1"},"connection_uris":[{"connection_uri":"postgresql://u:p@ep-new.neon.tech/db"}]}'
LIMIT_FULL='{"request_id":"r","code":"BRANCHES_LIMIT_EXCEEDED","message":"branches limit exceeded"}'
EMPTY_LIST='{"branches":[]}'

echo "=== preview-db-branch.sh: name (fixed width is the whole safety argument) ==="
for pair in "42:preview-pr-000042" "10000:preview-pr-010000" "0042:preview-pr-000042" "999999:preview-pr-999999"; do
  n="${pair%%:*}"; want="${pair#*:}"
  res="$(run_script name "$n")"; rc="${res%%|*}"; out="${res#*|}"
  if [ "$rc" = "0" ] && [ "$out" = "$want" ]; then pass "name $n -> $want"; else fail "name $n: rc=$rc out='$out' (want $want)"; fi
done
a="$(run_script name 1)"; a="${a#*|}"
b="$(run_script name 123456)"; b="${b#*|}"
if [ "${#a}" -eq "${#b}" ]; then
  pass "PR 1 and PR 123456 get names of the same length, so no name can prefix another's"
else
  fail "name width varies: '$a' vs '$b'"
fi
for bad in abc "" 12a; do
  res="$(run_script name "$bad")"; rc="${res%%|*}"
  if [ "$rc" = "64" ]; then pass "name '$bad' is a usage error (exit 64)"; else fail "name '$bad' should exit 64, got $rc"; fi
done

echo ""
echo "=== create: capacity available -> replace own branch, create, done ==="
stub_reset; gh_reset
stub_body 1 <<'EOF'
{"branches":[
  {"id":"br-own-old","name":"preview-pr-000042","created_at":"2026-09-01T00:00:00Z"},
  {"id":"br-other","name":"preview-pr-000041","created_at":"2026-08-01T00:00:00Z"},
  {"id":"br-main","name":"production","created_at":"2026-03-01T00:00:00Z"}
]}
EOF
# call 2 = DELETE of our previous branch; call 3 = POST create
stub_status 3 201; printf '%s' "$CREATE_OK" | stub_body 3
res="$(run_script create 42 --uri-out "$TMPDIR_T/a.uri")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "create succeeds (exit 0)"; else fail "create should exit 0, got $rc ($out)"; fi
if grep -qxF 'branch_id=br-new-1' <<<"$out"; then pass "create prints the new branch id on its typed line"; else fail "no branch_id= line in: $out"; fi
if grep -qxF 'branch_name=preview-pr-000042' <<<"$out"; then pass "create prints the fixed-width name"; else fail "no branch_name= line"; fi
if [ "$(deletes)" = "br-own-old" ]; then
  pass "a push replaces the PR's previous branch — and only that one (the older PR next to it survived)"
else
  fail "deletes were: $(deletes | tr '\n' ' ')"
fi
if [ "$(cat "$TMPDIR_T/a.uri")" = "postgresql://u:p@ep-new.neon.tech/db" ]; then pass "the connection URI reaches --uri-out"; else fail "--uri-out content wrong"; fi
if grep -qF 'postgresql://' <<<"$out"; then fail "the connection URI was printed"; else pass "the connection URI is never printed"; fi
if [ -s "$TMPDIR_T/gh.log" ]; then fail "GitHub was consulted although capacity was available"; else pass "GitHub is not consulted when capacity is available"; fi
if grep -qE '^(evicted|swept)' <<<"$out"; then fail "reclaim output appeared although nothing was reclaimed"; else pass "no reclaim output when nothing was reclaimed"; fi

echo ""
echo "=== create: allowance full -> closed PRs' branches go first ==="
stub_reset; gh_reset
gh_pr 7 closed; gh_pr 8 open            # PR 9 has no fixture: state unknown
printf '%s' "$EMPTY_LIST" | stub_body 1  # prune own: nothing to replace
stub_status 2 422; printf '%s' "$LIMIT_FULL" | stub_body 2
stub_body 3 <<'EOF'
{"branches":[
  {"id":"br-main","name":"production","created_at":"2026-03-01T00:00:00Z"},
  {"id":"br-closed","name":"preview-pr-000007","created_at":"2026-09-01T00:00:00Z"},
  {"id":"br-open","name":"preview-pr-000008","created_at":"2026-09-02T00:00:00Z"},
  {"id":"br-unknown","name":"preview-pr-000009","created_at":"2026-09-03T00:00:00Z"},
  {"id":"br-narrow","name":"preview-pr-12","created_at":"2020-01-01T00:00:00Z"},
  {"id":"br-snap","name":"db-snapshot-1-abc","created_at":"2020-01-01T00:00:00Z"}
]}
EOF
# call 4 = DELETE br-closed; call 5 = POST create -> ok
stub_status 5 201; printf '%s' "$CREATE_OK" | stub_body 5
res="$(run_script create 42 --uri-out "$TMPDIR_T/b.uri")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "create recovers from a full allowance (exit 0)"; else fail "create should recover, got $rc ($out)"; fi
if grep -qxF 'branch_id=br-new-1' <<<"$out"; then pass "the retried create's id is reported"; else fail "no branch_id after retry"; fi
if [ "$(deletes)" = "br-closed" ]; then
  pass "only the CLOSED PR's branch was deleted (open, unknown, mis-shaped and snapshot branches survived)"
else
  fail "deletes were: $(deletes | tr '\n' ' ')"
fi
if grep -qxF 'swept_pr=7' <<<"$out" && grep -qxF 'swept=1' <<<"$out"; then pass "the sweep names the PR it reclaimed"; else fail "swept output missing: $out"; fi
if grep -qE '::warning::.*#9 ' <<<"$out" || grep -qE '::warning::.*#9$' <<<"$out" || grep -qE '::warning::.*#9 for' <<<"$out"; then
  pass "an unknown PR state is kept and warned about, not deleted"
else
  fail "no warning for the PR whose state could not be resolved: $out"
fi
if grep -qE '^evicted' <<<"$out"; then fail "eviction ran although the sweep freed a slot"; else pass "no eviction once the sweep freed a slot"; fi
calls="$(gh_calls)"
if grep -qE '/pulls/7( |$)' <<<"$calls" && grep -qE '/pulls/8( |$)' <<<"$calls" && grep -qE '/pulls/9( |$)' <<<"$calls"; then
  pass "every six-digit preview branch had its PR looked up"
else
  fail "gh calls were: $(tr '\n' ' ' <<<"$calls")"
fi
if grep -qE '/pulls/12( |$)' <<<"$calls"; then
  fail "a branch outside the fixed-width shape (preview-pr-12) was treated as PR 12's"
else
  pass "a branch outside the fixed-width shape is never read as a PR number"
fi
if [ "$(posts)" = "2" ]; then pass "exactly one retry after the sweep"; else fail "expected 2 create attempts, saw $(posts)"; fi

echo ""
echo "=== create: still full after the sweep -> evict the least recently built, never a young one, never our own ==="
# Our own name appears in the list with the OLDEST date: the prune at the top
# should already have removed it, but if it is ever there it must not be the
# branch we evict — we are about to create it.
LIST_ALL_OPEN="$(cat <<EOF
{"branches":[
  {"id":"br-own-stale","name":"preview-pr-000042","created_at":"2025-01-01T00:00:00Z"},
  {"id":"br-young","name":"preview-pr-000003","created_at":"${NOW_ISO}"},
  {"id":"br-b","name":"preview-pr-000002","created_at":"2026-06-01T00:00:00Z"},
  {"id":"br-a","name":"preview-pr-000001","created_at":"2026-01-01T00:00:00Z"}
]}
EOF
)"
stub_reset; gh_reset
gh_pr 1 open; gh_pr 2 open; gh_pr 3 open; gh_pr 42 open
printf '%s' "$EMPTY_LIST" | stub_body 1
stub_status 2 422; printf '%s' "$LIMIT_FULL" | stub_body 2
printf '%s' "$LIST_ALL_OPEN" | stub_body 3   # sweep: everything open -> nothing
stub_status 4 422; printf '%s' "$LIMIT_FULL" | stub_body 4
printf '%s' "$LIST_ALL_OPEN" | stub_body 5   # evict list
# call 6 = DELETE br-a; call 7 = POST -> ok
stub_status 7 201; printf '%s' "$CREATE_OK" | stub_body 7
res="$(run_script create 42 --uri-out "$TMPDIR_T/c.uri")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "create recovers by evicting (exit 0)"; else fail "create should recover by evicting, got $rc ($out)"; fi
if [ "$(deletes)" = "br-a" ]; then
  pass "the LEAST RECENTLY CREATED open preview was evicted — not the newer one, not the young one, not our own"
else
  fail "deletes were: $(deletes | tr '\n' ' ')"
fi
if grep -qxF 'evicted_pr=1' <<<"$out" && grep -qxF 'evicted_branch=br-a' <<<"$out"; then pass "the evicted PR and branch are named for the caller"; else fail "evicted_* lines missing: $out"; fi
if grep -qxF 'swept=0' <<<"$out"; then pass "the sweep reported nothing to reclaim before eviction ran"; else fail "swept=0 missing"; fi
if grep -qxF 'branch_id=br-new-1' <<<"$out"; then pass "the create after eviction succeeded"; else fail "no branch_id after eviction"; fi
if [ "$(posts)" = "3" ]; then pass "one attempt per stage: initial, after sweep, after evict"; else fail "expected 3 create attempts, saw $(posts)"; fi

echo ""
echo "=== create: every other preview is younger than the job timeout -> refuse, exit 5, delete nothing ==="
LIST_YOUNG="$(cat <<EOF
{"branches":[{"id":"br-young","name":"preview-pr-000003","created_at":"${NOW_ISO}"}]}
EOF
)"
stub_reset; gh_reset; gh_pr 3 open
printf '%s' "$EMPTY_LIST" | stub_body 1
stub_status 2 422; printf '%s' "$LIMIT_FULL" | stub_body 2
printf '%s' "$LIST_YOUNG" | stub_body 3
stub_status 4 422; printf '%s' "$LIMIT_FULL" | stub_body 4
printf '%s' "$LIST_YOUNG" | stub_body 5
res="$(run_script create 42 --uri-out "$TMPDIR_T/d.uri")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "5" ]; then pass "a full allowance with nothing safe to reclaim exits 5"; else fail "expected exit 5, got $rc ($out)"; fi
if [ -z "$(deletes)" ]; then pass "a branch that may belong to a running job is never deleted"; else fail "deleted: $(deletes | tr '\n' ' ')"; fi
if grep -qF 'nothing is safe to reclaim' <<<"$out"; then pass "the error says this is a capacity outcome, not a pipeline bug"; else fail "error text missing: $out"; fi
if [ "$(posts)" = "2" ]; then pass "no third create attempt without a reclaimed slot"; else fail "expected 2 create attempts, saw $(posts)"; fi

# The knob exists so an operator can lower the floor deliberately; prove it is read.
stub_reset; gh_reset; gh_pr 3 open
printf '%s' "$EMPTY_LIST" | stub_body 1
stub_status 2 422; printf '%s' "$LIMIT_FULL" | stub_body 2
printf '%s' "$LIST_YOUNG" | stub_body 3
stub_status 4 422; printf '%s' "$LIMIT_FULL" | stub_body 4
printf '%s' "$LIST_YOUNG" | stub_body 5
stub_status 7 201; printf '%s' "$CREATE_OK" | stub_body 7
res="$(run_script PREVIEW_DB_MIN_AGE_SECONDS=0 create 42 --uri-out "$TMPDIR_T/e.uri")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ] && [ "$(deletes)" = "br-young" ] && grep -qxF 'evicted_pr=3' <<<"$out"; then
  pass "PREVIEW_DB_MIN_AGE_SECONDS=0 lowers the floor (the young branch is then evictable)"
else
  fail "min-age override not honoured: rc=$rc deletes=$(deletes | tr '\n' ' ') out=$out"
fi

echo ""
echo "=== create: still full AFTER an eviction -> exit 5 with the audit hint ==="
stub_reset; gh_reset; gh_pr 1 open
LIST_ONE='{"branches":[{"id":"br-a","name":"preview-pr-000001","created_at":"2026-01-01T00:00:00Z"}]}'
printf '%s' "$EMPTY_LIST" | stub_body 1
stub_status 2 422; printf '%s' "$LIMIT_FULL" | stub_body 2
printf '%s' "$LIST_ONE" | stub_body 3
stub_status 4 422; printf '%s' "$LIMIT_FULL" | stub_body 4
printf '%s' "$LIST_ONE" | stub_body 5
# call 6 = DELETE br-a (default 200); call 7 = POST still refused
stub_status 7 422; printf '%s' "$LIMIT_FULL" | stub_body 7
res="$(run_script create 42 --uri-out "$TMPDIR_T/f.uri")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "5" ]; then pass "still-full after eviction exits 5"; else fail "expected exit 5, got $rc"; fi
if grep -qF 'outside this pipeline' <<<"$out"; then pass "the error points at branches this pipeline does not own"; else fail "audit hint missing: $out"; fi
if [ "$(posts)" = "3" ]; then pass "no fourth attempt: one eviction per run"; else fail "expected 3 create attempts, saw $(posts)"; fi

echo ""
echo "=== create: any OTHER create failure is not a capacity problem -> exit 3, no reclaim ==="
stub_reset; gh_reset
printf '%s' "$EMPTY_LIST" | stub_body 1
stub_status 2 401; printf '%s' '{"code":"UNAUTHORIZED","message":"bad key"}' | stub_body 2
res="$(run_script create 42 --uri-out "$TMPDIR_T/g.uri")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "3" ]; then pass "a 401 stays exit 3"; else fail "a 401 should exit 3, got $rc"; fi
if [ -z "$(deletes)" ] && [ ! -s "$TMPDIR_T/gh.log" ]; then pass "no branch is deleted and GitHub is not consulted on a non-capacity failure"; else fail "reclaim ran on a 401"; fi
if [ "$(posts)" = "1" ]; then pass "no retry on a non-capacity failure"; else fail "expected 1 create attempt, saw $(posts)"; fi

stub_reset; gh_reset
res="$(run_script NEON_API_KEY= create 42 --uri-out "$TMPDIR_T/h.uri")"; rc="${res%%|*}"
if [ "$rc" = "2" ]; then pass "missing Neon credentials exit 2 (propagated from neon-branch.sh)"; else fail "missing credentials should exit 2, got $rc"; fi

echo ""
echo "=== create: eviction never touches a branch whose PR state GitHub could not confirm ==="
# "Uncertainty means keep" has to hold in BOTH reclaim steps. The first cut
# checked state only in the closed-PR sweep, so a GitHub outage, a rate limit
# or a token without pull-requests scope let step 2 evict a branch it knew
# nothing about — ten lines after warning that it was keeping it.
LIST_OLD_ONLY='{"branches":[{"id":"br-a","name":"preview-pr-000001","created_at":"2026-01-01T00:00:00Z"}]}'
stub_reset; gh_reset                       # no fixtures: every lookup fails
printf '%s' "$EMPTY_LIST" | stub_body 1
stub_status 2 422; printf '%s' "$LIMIT_FULL" | stub_body 2
printf '%s' "$LIST_OLD_ONLY" | stub_body 3
stub_status 4 422; printf '%s' "$LIMIT_FULL" | stub_body 4
printf '%s' "$LIST_OLD_ONLY" | stub_body 5
res="$(run_script create 42 --uri-out "$TMPDIR_T/i.uri")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "5" ]; then pass "GitHub unreachable while the allowance is full exits 5"; else fail "expected exit 5 with GitHub unreachable, got $rc ($out)"; fi
if [ -z "$(deletes)" ]; then pass "a branch whose PR state is unknown is never evicted"; else fail "evicted with state unknown: $(deletes | tr '\n' ' ')"; fi
if grep -qF 'not an eviction candidate' <<<"$out"; then pass "the skipped branch is warned about by name"; else fail "no warning for the unknown-state branch: $out"; fi

# The unknown one is skipped; the next oldest with a confirmed state is taken.
LIST_TWO_OLD='{"branches":[{"id":"br-a","name":"preview-pr-000001","created_at":"2026-01-01T00:00:00Z"},{"id":"br-b","name":"preview-pr-000002","created_at":"2026-06-01T00:00:00Z"}]}'
stub_reset; gh_reset; gh_pr 2 open         # PR 1 unknown, PR 2 open
printf '%s' "$EMPTY_LIST" | stub_body 1
stub_status 2 422; printf '%s' "$LIMIT_FULL" | stub_body 2
printf '%s' "$LIST_TWO_OLD" | stub_body 3
stub_status 4 422; printf '%s' "$LIMIT_FULL" | stub_body 4
printf '%s' "$LIST_TWO_OLD" | stub_body 5
# call 6 = DELETE br-b; call 7 = POST -> ok
stub_status 7 201; printf '%s' "$CREATE_OK" | stub_body 7
res="$(run_script create 42 --uri-out "$TMPDIR_T/j.uri")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ] && [ "$(deletes)" = "br-b" ] && grep -qxF 'evicted_pr=2' <<<"$out"; then
  pass "eviction skips the unknown-state branch and takes the next oldest whose state is confirmed"
else
  fail "unknown-first eviction: rc=$rc deletes=$(deletes | tr '\n' ' ') out=$out"
fi

# A CLOSED PR's branch that step 1 could not delete is not retried here either:
# it is step 1's, and the "push to rebuild" notice would land on a PR nobody
# will push to. The next oldest OPEN one is taken instead.
stub_reset; gh_reset; gh_pr 1 closed; gh_pr 2 open
printf '%s' "$EMPTY_LIST" | stub_body 1
stub_status 2 422; printf '%s' "$LIMIT_FULL" | stub_body 2
printf '%s' "$LIST_TWO_OLD" | stub_body 3
stub_status 4 500                          # sweep: DELETE br-a (closed) refused
stub_status 5 422; printf '%s' "$LIMIT_FULL" | stub_body 5
printf '%s' "$LIST_TWO_OLD" | stub_body 6
# call 7 = DELETE br-b (open, default 200); call 8 = POST -> ok
stub_status 8 201; printf '%s' "$CREATE_OK" | stub_body 8
res="$(run_script create 42 --uri-out "$TMPDIR_T/n.uri")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ] && [ "$(grep -c '^br-a$' <<<"$(deletes)")" = "1" ] && grep -qxF 'evicted_pr=2' <<<"$out"; then
  pass "a closed PR's branch the sweep could not delete is not retried by eviction; the next oldest OPEN one is taken"
else
  fail "closed-not-evicted: rc=$rc deletes=$(deletes | tr '\n' ' ') out=$out"
fi

echo ""
echo "=== create: a refused delete during eviction moves on to the next oldest ==="
stub_reset; gh_reset; gh_pr 1 open; gh_pr 2 open
printf '%s' "$EMPTY_LIST" | stub_body 1
stub_status 2 422; printf '%s' "$LIMIT_FULL" | stub_body 2
printf '%s' "$LIST_TWO_OLD" | stub_body 3
stub_status 4 422; printf '%s' "$LIMIT_FULL" | stub_body 4
printf '%s' "$LIST_TWO_OLD" | stub_body 5
stub_status 6 500                          # DELETE br-a refused
# call 7 = DELETE br-b (default 200); call 8 = POST -> ok
stub_status 8 201; printf '%s' "$CREATE_OK" | stub_body 8
res="$(run_script create 42 --uri-out "$TMPDIR_T/k.uri")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ] && [ "$(deletes | tr '\n' ' ')" = "br-a br-b " ] && grep -qxF 'evicted_pr=2' <<<"$out"; then
  pass "a refused delete is stepped over and the next oldest is evicted instead"
else
  fail "failed-delete advance: rc=$rc deletes=$(deletes | tr '\n' ' ') out=$out"
fi
if grep -qF 'trying the next oldest' <<<"$out"; then pass "the refused delete is warned about"; else fail "no warning for the refused delete"; fi

echo ""
echo "=== create: a fractional-seconds created_at still parses (an unparseable date would make a row un-evictable) ==="
LIST_FRAC='{"branches":[{"id":"br-frac","name":"preview-pr-000001","created_at":"2026-01-01T00:00:00.500Z"}]}'
stub_reset; gh_reset; gh_pr 1 open
printf '%s' "$EMPTY_LIST" | stub_body 1
stub_status 2 422; printf '%s' "$LIMIT_FULL" | stub_body 2
printf '%s' "$LIST_FRAC" | stub_body 3
stub_status 4 422; printf '%s' "$LIMIT_FULL" | stub_body 4
printf '%s' "$LIST_FRAC" | stub_body 5
stub_status 7 201; printf '%s' "$CREATE_OK" | stub_body 7
res="$(run_script create 42 --uri-out "$TMPDIR_T/m.uri")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ] && [ "$(deletes)" = "br-frac" ] && grep -qxF 'evicted_pr=1' <<<"$out"; then
  pass "a created_at with fractional seconds is parsed and the branch is evictable"
else
  fail "fractional created_at: rc=$rc deletes=$(deletes | tr '\n' ' ') out=$out"
fi

echo ""
echo "=== output channels: typed lines on stdout, diagnostics on stderr, even when the create fails ==="
# ci.yml captures stdout to read evicted_pr= and must still see the ::error::
# lines when the script exits non-zero — an eviction followed by a failed
# create is the one case where both matter at once. Re-run that shape with the
# streams kept apart. Every other case merges them, so this is the only one
# that can see a diagnostic land on the wrong stream.
stub_reset; gh_reset; gh_pr 1 open
printf '%s' "$EMPTY_LIST" | stub_body 1
stub_status 2 422; printf '%s' "$LIMIT_FULL" | stub_body 2
printf '%s' "$LIST_ONE" | stub_body 3
stub_status 4 422; printf '%s' "$LIMIT_FULL" | stub_body 4
printf '%s' "$LIST_ONE" | stub_body 5
stub_status 7 422; printf '%s' "$LIMIT_FULL" | stub_body 7
res="$(run_script_split create 42 --uri-out "$TMPDIR_T/l.uri")"; rc="${res%%|*}"; out="${res#*|}"
err="$(stderr_log)"
if [ "$rc" = "5" ]; then pass "(shape reproduced: exit 5 after an eviction)"; else fail "expected exit 5, got $rc"; fi
if grep -qxF 'evicted_pr=1' <<<"$out"; then
  pass "evicted_pr= reaches STDOUT although the create then failed (the caller can still tell that PR)"
else
  fail "evicted_pr= missing from stdout: $out"
fi
if grep -qE '^::(error|warning|notice)::' <<<"$out"; then
  fail "diagnostics leaked into stdout, where a caller that captures it would hide them: $out"
else
  pass "no ::error::/::warning::/::notice:: on stdout"
fi
if grep -qF 'outside this pipeline' <<<"$err"; then
  pass "the ::error:: is on STDERR, so it reaches the job log whatever the caller does with stdout"
else
  fail "the ::error:: did not reach stderr: $err"
fi

echo ""
echo "=== sweep: closed PRs, dry-run leftovers, expired snapshots — and nothing else ==="
stub_reset; gh_reset
gh_pr 7 closed; gh_pr 8 open            # 9 unknown
stub_default <<EOF
{"branches":[
  {"id":"br-main","name":"production","created_at":"2026-03-01T00:00:00Z"},
  {"id":"br-stage","name":"staging","created_at":"2026-03-03T00:00:00Z"},
  {"id":"br-c7","name":"preview-pr-000007","created_at":"2026-09-01T00:00:00Z"},
  {"id":"br-o8","name":"preview-pr-000008","created_at":"2026-09-02T00:00:00Z"},
  {"id":"br-u9","name":"preview-pr-000009","created_at":"2026-09-03T00:00:00Z"},
  {"id":"br-dry-old","name":"db-dryrun-1-aaaa","created_at":"2020-01-01T00:00:00Z"},
  {"id":"br-dry-new","name":"db-dryrun-2-bbbb","created_at":"${NOW_ISO}"},
  {"id":"br-snap-old","name":"db-snapshot-1-cccc","created_at":"2020-01-01T00:00:00Z"},
  {"id":"br-snap-new","name":"db-snapshot-2-dddd","created_at":"${NOW_ISO}"},
  {"id":"br-vercel","name":"preview/fix-thing","created_at":"2020-01-01T00:00:00Z"}
]}
EOF
res="$(run_script sweep)"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "sweep succeeds (exit 0)"; else fail "sweep should exit 0, got $rc ($out)"; fi
got="$(deletes | sort | tr '\n' ' ')"
if [ "$got" = "br-c7 br-dry-old br-snap-old " ]; then
  pass "sweep deleted exactly: the closed PR's preview, the day-old dry run, the expired snapshot"
else
  fail "sweep deletes were: $got"
fi
if grep -qxF 'swept_pr=7' <<<"$out" && grep -qxF 'swept=1' <<<"$out"; then pass "sweep names the closed PR it reclaimed"; else fail "swept output missing"; fi
if [ "$(grep -cxF 'pruned=1' <<<"$out")" = "2" ]; then pass "the dry-run and snapshot prunes each report their one deletion"; else fail "expected two pruned=1 lines in: $out"; fi
if grep -qF 'br-vercel' "$TMPDIR_T/stub.log" && grep -qE '^DELETE .*br-vercel' "$TMPDIR_T/stub.log"; then
  fail "sweep deleted a branch outside the three name shapes"
else
  pass "a branch outside the three name shapes (a Vercel-integration preview/...) is never touched"
fi
res="$(run_script sweep extra)"; rc="${res%%|*}"
if [ "$rc" = "64" ]; then pass "sweep takes no arguments (exit 64)"; else fail "sweep extra should exit 64, got $rc"; fi

# A refused delete is warned about, never fatal, and the count stays honest.
stub_reset; gh_reset; gh_pr 7 closed
stub_default <<'EOF'
{"branches":[{"id":"br-c7","name":"preview-pr-000007","created_at":"2026-09-01T00:00:00Z"}]}
EOF
stub_status 2 500                          # DELETE br-c7 refused
res="$(run_script sweep)"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ] && grep -qxF 'swept=0' <<<"$out" && grep -qF 'could not delete' <<<"$out"; then
  pass "a refused delete in the sweep is warned about and not counted (exit 0)"
else
  fail "sweep refused-delete: rc=$rc out=$out"
fi

echo ""
echo "=== sweep: GitHub unreachable -> nothing swept, warned, still exit 0; Neon unreachable -> exit 3 ==="
stub_reset; gh_reset
gh_pr 7 closed
stub_default <<'EOF'
{"branches":[
  {"id":"br-c7","name":"preview-pr-000007","created_at":"2026-09-01T00:00:00Z"},
  {"id":"br-dry-old","name":"db-dryrun-1-aaaa","created_at":"2020-01-01T00:00:00Z"}
]}
EOF
res="$(run_script GITHUB_REPOSITORY= sweep)"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "an unresolvable PR state does not fail the sweep"; else fail "sweep should exit 0 when GitHub cannot answer, got $rc"; fi
if [ "$(deletes)" = "br-dry-old" ]; then
  pass "with no way to ask GitHub, no preview branch is deleted (the dry-run prune still ran)"
else
  fail "deletes were: $(deletes | tr '\n' ' ')"
fi
if grep -qF '::warning::' <<<"$out" && grep -qxF 'swept=0' <<<"$out"; then pass "the kept branch is warned about"; else fail "no warning / swept=0: $out"; fi

stub_reset; gh_reset
stub_status 1 500
res="$(run_script sweep)"; rc="${res%%|*}"
if [ "$rc" = "3" ]; then pass "a failed Neon list is reported (exit 3), never read as nothing-to-do"; else fail "expected exit 3 on a failed list, got $rc"; fi

echo ""
echo "=== usage contract ==="
assert_usage() {
  local label="$1"; shift
  local res rc
  res="$(run_script "$@")"
  rc="${res%%|*}"
  if [ "$rc" = "64" ]; then pass "$label is a usage error (exit 64)"; else fail "$label should exit 64, got $rc"; fi
}
assert_usage "no subcommand" ""
assert_usage "unknown subcommand" bogus
assert_usage "create with no arguments" create
assert_usage "create without --uri-out" create 42
assert_usage "create with --uri-out and no path" create 42 --uri-out
assert_usage "create with two PR numbers" create 4 2 --uri-out "$TMPDIR_T/u.uri"
assert_usage "create with an unknown flag" create 42 --wat --uri-out "$TMPDIR_T/u.uri"
assert_usage "create with a non-numeric PR" create forty-two --uri-out "$TMPDIR_T/u.uri"
assert_usage "name with no argument" name

echo ""
echo "=== wiring: the workflows call this script, and CI runs this suite ==="
# Comment-stripped copies: a mention in a comment is not a wiring.
ci_raw="$(cat "$CI_YML")"
ci_exec="$(grep -v '^[[:space:]]*#' <<<"$ci_raw" || true)"
cleanup_raw="$(cat "$CLEANUP_YML")"
cleanup_exec="$(grep -v '^[[:space:]]*#' <<<"$cleanup_raw" || true)"
script_raw="$(cat "$SCRIPT")"
script_exec="$(grep -v '^[[:space:]]*#' <<<"$script_raw" || true)"
if [ -z "$ci_exec" ] || [ -z "$cleanup_exec" ] || [ -z "$script_exec" ]; then
  fail "a workflow or the script read back empty — the wiring checks below would be vacuous"
fi
# shellcheck disable=SC2016
# The single quotes are deliberate: the pattern matches the LITERAL "$PR_NUMBER"
# in the workflow's run: block, so it must not expand here.
if grep -qE 'bash scripts/preview-db-branch\.sh create "\$PR_NUMBER" --uri-out' <<<"$ci_exec"; then
  pass "preview-deploy creates its branch through the policy script"
else
  fail "ci.yml does not call preview-db-branch.sh create — the reclaim policy is not in the preview job"
fi
# The id must come from the TYPED line. The output carries evicted_branch=br-...
# BEFORE branch_id= when a branch was reclaimed, so the loose "first br- token"
# parse the step used to carry would ship the EVICTED id as this preview's.
if grep -qF "sed -n 's/^branch_id=//p'" <<<"$ci_exec"; then
  pass "preview-deploy reads branch_id from its typed line, not the first br- token"
else
  fail "ci.yml no longer parses branch_id= by its typed line"
fi
# Under `set -e`, a bare `out="$(...)"` aborts the step at the assignment when
# the policy fails, and everything it printed to stdout — evicted_pr= above
# all — is dropped. The capture has to record the code and go on.
# shellcheck disable=SC2016
# Literal "$uri_file" / "$?" in the workflow's run: block; no expansion wanted.
if grep -qE 'bash scripts/preview-db-branch\.sh create "\$PR_NUMBER" --uri-out "\$uri_file"\)" \|\| rc=\$\?' <<<"$ci_exec"; then
  pass "preview-deploy captures the policy's exit code instead of letting errexit drop its output"
else
  fail "ci.yml lets errexit abort at the capture — evicted_pr= never reaches the outputs when the create fails"
fi
if grep -qE "^[[:space:]]+if: always\(\) && steps\.neon-branch\.outputs\.evicted_pr != ''" <<<"$ci_exec"; then
  pass "the evicted-PR comment runs even when this PR's own create then failed (always())"
else
  fail "the evicted-PR comment step is not gated on always(): an eviction followed by a failed create tells nobody"
fi
# The sweep job's event gate, derived from the job block rather than restated:
# a run: line that exists but sits under a false if: is not wiring.
sweep_block="$(awk '/^  sweep:/{f=1} f' <<<"$cleanup_exec")"
cleanup_block="$(awk '/^  cleanup:/{f=1} /^  sweep:/{f=0} f' <<<"$cleanup_exec")"
if grep -qF 'bash scripts/preview-db-branch.sh sweep' <<<"$cleanup_block" \
  && ! grep -qE "prune ['\"]?preview-pr-['\"]? [0-9]+" <<<"$cleanup_block" \
  && grep -qF 'pull-requests: read' <<<"$cleanup_block" \
  && grep -qF 'GH_TOKEN:' <<<"$cleanup_block"; then
  pass "close-event housekeeping checks PR state instead of deleting old open previews"
else
  fail "close-event housekeeping bypasses the state-aware sweep or cannot read PR state"
fi
if [ -n "$sweep_block" ] && grep -qE "^[[:space:]]+if: github\.event_name != 'pull_request'" <<<"$sweep_block"; then
  pass "the sweep job admits the schedule and dispatch events"
else
  fail "could not find the sweep job's event gate in preview-db-cleanup.yml"
fi
if grep -qF 'bash scripts/__tests__/preview-db-branch.test.sh' <<<"$ci_exec"; then
  pass "CI runs this suite"
else
  fail "CI does not run scripts/__tests__/preview-db-branch.test.sh — regressions would ship green"
fi
if grep -qF 'scripts/preview-db-branch.sh scripts/__tests__/preview-db-branch.test.sh' <<<"$ci_exec"; then
  pass "CI shellchecks the script and this suite"
else
  fail "CI does not shellcheck scripts/preview-db-branch.sh"
fi
if grep -qE '^[[:space:]]+schedule:' <<<"$cleanup_exec" && grep -qE '^[[:space:]]+- cron:' <<<"$cleanup_exec"; then
  pass "the cleanup workflow has a schedule trigger (the close event alone was the gap)"
else
  fail "preview-db-cleanup.yml has no schedule trigger"
fi
if grep -qE 'bash scripts/preview-db-branch\.sh sweep' <<<"$cleanup_exec"; then
  pass "the cleanup workflow runs the sweep"
else
  fail "preview-db-cleanup.yml does not run preview-db-branch.sh sweep"
fi
# shellcheck disable=SC2016
# Same: a literal "$PR_NUMBER" in the cleanup workflow's run: block.
if grep -qE 'bash scripts/preview-db-branch\.sh name "\$PR_NUMBER"' <<<"$cleanup_exec"; then
  pass "the per-PR delete derives the name from the same code the create uses"
else
  fail "preview-db-cleanup.yml computes the branch name on its own — the two shapes can drift"
fi

echo ""
echo "=== the eviction floor covers the preview job's timeout (derived from both sources) ==="
# The whole safety argument for evicting an open PR's branch is that a branch
# older than the job timeout cannot belong to a running job. Derive both
# numbers rather than restating them, so a change to either side shows up here.
timeout_min="$(awk '/^  preview-deploy:/{f=1} f && /timeout-minutes:/{print $2; exit}' <<<"$ci_exec")"
default_age="$(sed -nE 's/^: "\$\{PREVIEW_DB_MIN_AGE_SECONDS:=([0-9]+)\}"$/\1/p' <<<"$script_exec" | head -1)"
if [ -z "$timeout_min" ] || [ -z "$default_age" ]; then
  fail "could not derive preview-deploy's timeout-minutes ('${timeout_min:-?}') or the script's default min age ('${default_age:-?}')"
elif [ "$default_age" -ge $(( timeout_min * 60 )) ]; then
  pass "default min age ${default_age}s >= the preview job's ${timeout_min}-minute timeout"
else
  fail "default min age ${default_age}s is below the preview job's ${timeout_min}-minute timeout — an evicted branch could belong to a running job"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
