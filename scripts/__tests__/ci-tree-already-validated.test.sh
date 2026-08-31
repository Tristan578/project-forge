#!/usr/bin/env bash
# Contract test for scripts/ci-tree-already-validated.sh — the gate that lets
# cd.yml skip re-running lint / typecheck / vitest / MCP / the Rust audit / the
# E2E shards when CI already validated the identical tree.
#
# WHY THIS SUITE IS MOSTLY NEGATIVE CASES
#
# The two failure directions are not symmetric:
#
#   a false NEGATIVE costs one slow deploy.
#   a false POSITIVE ships an unvalidated tree to production.
#
# So the interesting assertions are not "does it say true when it should" — that
# is one case — but "does it say false for every way the proof can be absent".
# Each branch below is one way the evidence can fail, and every one of them must
# print validated=false rather than guessing. If a future edit makes the script
# optimistic anywhere, exactly one of these goes red.
#
# The positive case is pinned too, because a gate that can only ever say false
# is not safe, it is broken — it would silently restore the 24.8 job-min of
# duplication this exists to remove, and nothing would look wrong.
#
# gh is driven through $GH_CLI, so no case here touches the network.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../ci-tree-already-validated.sh"
CD_YML="$HERE/../../.github/workflows/cd.yml"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

[ -f "$SCRIPT" ] || { echo "gate script not found: $SCRIPT"; exit 1; }

TREE_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
TREE_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
HEAD_SHA="cccccccccccccccccccccccccccccccccccccccc"

# A stub `gh` whose three answers are supplied per-case. Any of them may be the
# literal string ERROR, which makes the stub exit non-zero — the "API failed"
# branch.
make_gh() {
  local dir="$1" pr_head="$2" conclusion="$3" tree="$4"
  cat > "$dir/gh" <<STUB
#!/usr/bin/env bash
case "\$*" in
  *"/pulls/"*)        out='${pr_head}' ;;
  *"/check-runs"*)    out='${conclusion}' ;;
  *"/commits/"*)      out='${tree}' ;;
  *)                  out='' ;;
esac
if [ "\$out" = "ERROR" ]; then exit 1; fi
printf '%s\n' "\$out"
STUB
  chmod +x "$dir/gh"
}

# run_case <label> <subject> <pr_head> <conclusion> <pr_tree> [event]
# Echoes the script's stdout.
run_case() {
  local label="$1" subject="$2" pr_head="$3" conclusion="$4" pr_tree="$5" event="${6:-push}"
  local dir repo
  dir="$(mktemp -d)"
  make_gh "$dir" "$pr_head" "$conclusion" "$pr_tree"
  repo="$(mktemp -d)"
  (
    cd "$repo" || exit 1
    git init -q
    git config user.email t@t.t
    git config user.name t
    printf 'x\n' > f.txt
    git add -A
    git commit -qm "$subject"
  )
  ( cd "$repo" && GH_CLI="$dir/gh" \
      GITHUB_REPOSITORY="o/r" \
      GITHUB_EVENT_NAME="$event" \
      TREE_OVERRIDE="$TREE_A" \
      bash "$SCRIPT" 2>&1 )
  rm -rf "$dir" "$repo"
}

assert_verdict() {
  local label="$1" want="$2" out="$3"
  if grep -qx "validated=${want}" <<<"$out"; then
    pass "$label -> validated=${want}"
  else
    fail "$label -> expected validated=${want}, got: $(tr '\n' ' ' <<<"$out")"
  fi
}

echo "=== ci-tree-already-validated.sh ==="

# --- The one positive case ----------------------------------------------------
OUT="$(run_case ok "feat: a change (#123)" "$HEAD_SHA" success "$TREE_A")"
assert_verdict "green check on the identical tree" true "$OUT"
if grep -q "identical tree" <<<"$OUT"; then
  pass "the positive verdict states what it proved"
else
  fail "positive verdict did not explain itself: $OUT"
fi

echo ""
echo "--- every way the proof can be absent must fail closed ---"

# The safety property. A PR that was behind main when CI ran has a different
# tree from the squashed result, so a green check is NOT proof for this content.
OUT="$(run_case mismatch "feat: a change (#123)" "$HEAD_SHA" success "$TREE_B")"
assert_verdict "green check but a DIFFERENT tree" false "$OUT"
if grep -q "tree mismatch" <<<"$OUT"; then
  pass "the tree-mismatch refusal names both trees"
else
  fail "expected a 'tree mismatch' explanation, got: $OUT"
fi

# A direct push to main has no pull-request reference to follow.
OUT="$(run_case direct "hotfix: pushed straight to main" "$HEAD_SHA" success "$TREE_A")"
assert_verdict "no '(#N)' in the subject (direct push)" false "$OUT"

# Non-success conclusions, one per state. None of these is proof.
for state in failure cancelled skipped neutral timed_out action_required; do
  OUT="$(run_case "$state" "feat: a change (#123)" "$HEAD_SHA" "$state" "$TREE_A")"
  assert_verdict "check concluded '$state'" false "$OUT"
done

# The check is absent entirely — an empty list must not read as success.
OUT="$(run_case missing "feat: a change (#123)" "$HEAD_SHA" "" "$TREE_A")"
assert_verdict "the required check is absent" false "$OUT"

# Still running. 'queued'/'in_progress' have a null conclusion, which must not
# be mistaken for a pass.
OUT="$(run_case pending "feat: a change (#123)" "$HEAD_SHA" "null" "$TREE_A")"
assert_verdict "the required check is still pending (null conclusion)" false "$OUT"

# Each API call failing in turn.
OUT="$(run_case pr_err "feat: a change (#123)" ERROR success "$TREE_A")"
assert_verdict "the pull-request lookup fails" false "$OUT"
OUT="$(run_case check_err "feat: a change (#123)" "$HEAD_SHA" ERROR "$TREE_A")"
assert_verdict "the check-runs lookup fails" false "$OUT"
OUT="$(run_case tree_err "feat: a change (#123)" "$HEAD_SHA" success ERROR)"
assert_verdict "the tree lookup fails" false "$OUT"

# A malformed head sha must not be handed to the next call.
OUT="$(run_case bad_sha "feat: a change (#123)" "not-a-sha" success "$TREE_A")"
assert_verdict "the PR head sha is malformed" false "$OUT"

# An explicit dispatch is a request to run the pipeline, whatever the tree says.
OUT="$(run_case dispatch "feat: a change (#123)" "$HEAD_SHA" success "$TREE_A" workflow_dispatch)"
assert_verdict "workflow_dispatch" false "$OUT"

echo ""
echo "--- usage errors are not verdicts ---"
# A missing GITHUB_REPOSITORY is a misconfiguration. It must NOT print
# validated=false and exit 0, because that is indistinguishable from a real
# answer and would hide a broken job behind a merely-slow one.
TMPR="$(mktemp -d)"
OUT="$( ( cd "$TMPR" && GITHUB_REPOSITORY='' bash "$SCRIPT" 2>&1 ) )" && RC=0 || RC=$?
rm -rf "$TMPR"
if [ "$RC" -ne 0 ]; then
  pass "a missing GITHUB_REPOSITORY exits non-zero rather than answering (exit $RC)"
else
  fail "a misconfiguration produced a verdict instead of an error: $OUT"
fi

echo ""
echo "=== the check-runs query must be paginated ==="
# GitHub's check-runs endpoint returns 30 per page by default. Measured on
# c4ee8fdf, a PR head in this repo carried 40 check-runs -- so an unpaginated
# call sees 30 of them and whether "CI Success" is among those 30 is ordering
# luck. Missing it answers validated=false, which is SAFE (the full block runs)
# but entirely silent: the optimisation stops paying off and nothing looks
# wrong. That is not observable from behaviour, so it is pinned structurally.
CHECK_RUNS_LINE="$(grep -n 'check-runs' "$SCRIPT" | grep -v '^[0-9]*:#' | head -1)"
if [ -z "$CHECK_RUNS_LINE" ]; then
  fail "could not find the check-runs query in $SCRIPT"
else
  if grep -q 'per_page=100' <<<"$CHECK_RUNS_LINE"; then
    pass "the check-runs query asks for per_page=100"
  else
    fail "the check-runs query does not set per_page: $CHECK_RUNS_LINE"
  fi
  if grep -q -- '--paginate' <<<"$CHECK_RUNS_LINE"; then
    pass "the check-runs query is --paginate'd (a commit here can exceed one page)"
  else
    fail "the check-runs query is not paginated: $CHECK_RUNS_LINE"
  fi
fi

echo ""
echo "=== cd.yml wiring ==="
if [ ! -f "$CD_YML" ]; then
  fail "cd.yml not found at $CD_YML"
else
  if grep -q 'scripts/ci-tree-already-validated\.sh' "$CD_YML"; then
    pass "cd.yml derives the skip decision from the shared gate script"
  else
    fail "cd.yml does not call scripts/ci-tree-already-validated.sh"
  fi
  # Every job the skip is allowed to touch must consult THIS output. A job left
  # ungated is only wasted spend; a job gated on something else is the dangerous
  # direction, so each one is asserted by name rather than checking that the
  # string appears somewhere in the file.
  # security is deliberately NOT in this list. The suite argues at
  # check-npm-audit.test.sh:1849 that a job-level needs: on the Rust audit lets a
  # skipped dependency cascade-skip it, and the audit is 0.8 of the 24.8 job-min
  # on offer -- not worth trading that guardrail for. It still runs on every
  # push to main, and deploy-staging keeps its original clause for it.
  for job in lint typecheck test-web test-mcp e2e; do
    block="$(awk -v j="  ${job}:" '$0 == j {f=1; next} f && /^  [a-z][a-z0-9-]*:$/ {exit} f' "$CD_YML")"
    if [ -z "$block" ]; then
      fail "cd.yml has no '${job}:' job to gate"
    elif grep -q 'needs\.check-validated\.outputs\.validated' <<<"$block"; then
      pass "cd.yml '${job}' is gated on check-validated"
    else
      fail "cd.yml '${job}' does not consult needs.check-validated.outputs.validated"
    fi
  done
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
