#!/usr/bin/env bash
# Unit tests for scripts/resolve-ci-diff-range.sh, plus wiring pins that keep
# the token-free bot-PR unblock (#9161 / #9193 / #9381) from being silently
# undone.
#
# WHY THE FAILURE CASES MATTER MORE THAN THE HAPPY PATH
# ----------------------------------------------------
# Every ci-gate output is a grep over the diff this script resolves. If the
# script ever answered "no range" by emitting nothing, `git diff` would be
# handed empty SHAs, CHANGED would come back empty, all fourteen filters would
# read false, every path-gated job would skip — and check-ci-success.sh
# deliberately tolerates legitimate skips. The result is a green "CI Success"
# over a CI run that executed no gate at all. So the bulk of this suite asserts
# that unresolvable input EXITS NON-ZERO and writes NO outputs.
#
# The wiring pins at the end assert the other half of the fix: ci.yml still
# carries the workflow_dispatch trigger and still consumes this script's
# outputs, and the two bot-PR producers still dispatch it. Any one of those
# reverting restores the permanently-unmergeable-PR bug with CI fully green.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/resolve-ci-diff-range.sh"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
RELEASE_YML="$REPO_ROOT/.github/workflows/release.yml"
RATCHET_YML="$REPO_ROOT/.github/workflows/coverage-ratchet.yml"
QG_YML="$REPO_ROOT/.github/workflows/quality-gates.yml"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "script not found: $SCRIPT"; exit 1; }

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

# ---- Fixture: a real git repo with a main branch and a topic branch ---------
#
# The workflow_dispatch path shells out to `git merge-base`, so it needs actual
# objects. A fixture repo is used rather than a stubbed git: a stub would let a
# broken merge-base invocation pass.
FIXTURE="$TMPROOT/repo"
mkdir -p "$FIXTURE"
(
  cd "$FIXTURE" || exit 1
  git init --quiet --initial-branch=main .
  git config user.email test@example.com
  git config user.name test
  echo one > file.txt
  git add file.txt
  git commit --quiet -m one
  # Mirror the shape checkout leaves behind: a remote-tracking ref for the
  # default branch. No real remote is needed.
  git update-ref refs/remotes/origin/main HEAD
  git checkout --quiet -b topic
  echo two >> file.txt
  git commit --quiet -am two
) || { echo "fixture setup failed"; exit 1; }

MAIN_SHA="$(git -C "$FIXTURE" rev-parse main)"
TOPIC_SHA="$(git -C "$FIXTURE" rev-parse topic)"

# run_resolve ENV=VAL ...  -> sets RESOLVE_RC and RESOLVE_OUT
run_resolve() {
  local out="$TMPROOT/out.$$"
  : > "$out"
  RESOLVE_RC=0
  ( cd "$FIXTURE" && env GITHUB_OUTPUT="$out" "$@" bash "$SCRIPT" ) >/dev/null 2>&1 || RESOLVE_RC=$?
  RESOLVE_OUT="$(cat "$out")"
  rm -f "$out"
}

# ---- pull_request: passes the event payload straight through ---------------
run_resolve EVENT_NAME=pull_request PR_BASE_SHA=aaa111 PR_HEAD_SHA=bbb222
if [ "$RESOLVE_RC" -eq 0 ] &&
  grep -qx 'base-sha=aaa111' <<<"$RESOLVE_OUT" &&
  grep -qx 'head-sha=bbb222' <<<"$RESOLVE_OUT"; then
  pass "pull_request: emits the event's base and head SHAs verbatim"
else
  fail "pull_request: expected base-sha=aaa111/head-sha=bbb222, got rc=$RESOLVE_RC [$RESOLVE_OUT]"
fi

# ---- workflow_dispatch: merge-base against the default branch --------------
run_resolve EVENT_NAME=workflow_dispatch DISPATCH_SHA="$TOPIC_SHA" DEFAULT_BRANCH=main
if [ "$RESOLVE_RC" -eq 0 ] &&
  grep -qx "base-sha=${MAIN_SHA}" <<<"$RESOLVE_OUT" &&
  grep -qx "head-sha=${TOPIC_SHA}" <<<"$RESOLVE_OUT"; then
  pass "workflow_dispatch: bases the diff on merge-base(origin/main, github.sha)"
else
  fail "workflow_dispatch: expected base=$MAIN_SHA head=$TOPIC_SHA, got rc=$RESOLVE_RC [$RESOLVE_OUT]"
fi

# A dispatch on the default-branch tip is a degenerate but legal range
# (merge-base == head, empty diff). It must still resolve rather than error, so
# a manual re-run on main does not read as a broken gate.
run_resolve EVENT_NAME=workflow_dispatch DISPATCH_SHA="$MAIN_SHA" DEFAULT_BRANCH=main
if [ "$RESOLVE_RC" -eq 0 ] && grep -qx "base-sha=${MAIN_SHA}" <<<"$RESOLVE_OUT"; then
  pass "workflow_dispatch: dispatch on the default-branch tip resolves to itself"
else
  fail "workflow_dispatch on main tip: expected rc=0, got rc=$RESOLVE_RC [$RESOLVE_OUT]"
fi

# ---- Failure posture: never emit a range the script is unsure of -----------
assert_hard_failure() {
  local label="$1"
  shift
  run_resolve "$@"
  if [ "$RESOLVE_RC" -eq 0 ]; then
    fail "$label: exited 0 — an unresolved range must fail the gate, not skip it"
  elif [ -n "$RESOLVE_OUT" ]; then
    fail "$label: exited non-zero but still wrote outputs [$RESOLVE_OUT]"
  else
    pass "$label: exits non-zero and writes no outputs"
  fi
}

assert_hard_failure "pull_request with empty base SHA" \
  EVENT_NAME=pull_request PR_BASE_SHA= PR_HEAD_SHA=bbb222
assert_hard_failure "pull_request with empty head SHA" \
  EVENT_NAME=pull_request PR_BASE_SHA=aaa111 PR_HEAD_SHA=
assert_hard_failure "workflow_dispatch with empty github.sha" \
  EVENT_NAME=workflow_dispatch DISPATCH_SHA= DEFAULT_BRANCH=main
assert_hard_failure "workflow_dispatch against an unknown default branch" \
  EVENT_NAME=workflow_dispatch DISPATCH_SHA="$TOPIC_SHA" DEFAULT_BRANCH=nonexistent-branch
assert_hard_failure "unset event name" \
  EVENT_NAME=
assert_hard_failure "unsupported event name" \
  EVENT_NAME=push DISPATCH_SHA="$TOPIC_SHA" DEFAULT_BRANCH=main

# GITHUB_OUTPUT missing entirely — the one case run_resolve cannot express,
# since it always sets it.
rc=0
(cd "$FIXTURE" && env -u GITHUB_OUTPUT EVENT_NAME=pull_request PR_BASE_SHA=a PR_HEAD_SHA=b \
  bash "$SCRIPT") >/dev/null 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then
  pass "unset GITHUB_OUTPUT: exits non-zero"
else
  fail "unset GITHUB_OUTPUT: exited 0 — the resolved range went nowhere and the gate stayed green"
fi

# ---- Wiring pins ------------------------------------------------------------
#
# Reference, not execution — what a static check can honestly claim. Each pin
# names the ticket it protects so a future editor knows what breaks.
pin() {
  local label="$1" file="$2" pattern="$3"
  if [ ! -f "$file" ]; then
    fail "$label: $file not found"
    return
  fi
  if grep -Eq "$pattern" "$file"; then
    pass "$label"
  else
    fail "$label: no line matching /$pattern/ in ${file##*/}"
  fi
}

pin "ci.yml still declares the workflow_dispatch trigger (#9161/#9381)" \
  "$CI_YML" '^  workflow_dispatch:'
pin "ci.yml resolves the diff range through this script" \
  "$CI_YML" 'scripts/resolve-ci-diff-range\.sh'
pin "ci-gate consumes the resolved base SHA" \
  "$CI_YML" 'BASE_SHA: \$\{\{ steps\.[a-z-]+\.outputs\.base-sha \}\}'
pin "ci-gate consumes the resolved head SHA" \
  "$CI_YML" 'HEAD_SHA: \$\{\{ steps\.[a-z-]+\.outputs\.head-sha \}\}'
pin "preview-deploy stays pull_request-only (it comments with pull_request.number)" \
  "$CI_YML" "github\.event_name == 'pull_request'"
pin "release.yml dispatches CI onto the release branch (#9161/#9381)" \
  "$RELEASE_YML" 'gh workflow run ci\.yml'
pin "release.yml grants the actions: write the dispatch needs" \
  "$RELEASE_YML" '^  actions: write'
pin "coverage-ratchet.yml dispatches CI onto the ratchet branch (#9193)" \
  "$RATCHET_YML" 'gh workflow run ci\.yml'
pin "coverage-ratchet.yml grants the actions: write the dispatch needs" \
  "$RATCHET_YML" '^  actions: write'

# ---- No quality gate may hide behind the event name ------------------------
#
# The point of dispatching CI at a bot branch is that "CI Success" means the
# SAME thing there as on a human PR. A job inside quality-gates.yml that gates
# on `github.event_name == 'pull_request'` silently skips on the dispatch path
# while the reusable workflow — and therefore CI Success — still reports green.
# Two jobs did exactly that (lighthouse-delta, storybook-internal-gate) and both
# now gate on a path input instead. Reintroducing an event gate anywhere in that
# file re-opens the hole, so it is refused wholesale rather than named job by
# job: a future job would not be covered by a per-job pin.
if [ ! -f "$QG_YML" ]; then
  fail "quality-gates.yml not found at $QG_YML"
else
  qg_exec="$(grep -v '^[[:space:]]*#' "$QG_YML")"
  if [ -z "$qg_exec" ]; then
    fail "comment-strip of quality-gates.yml produced no output — the assertions below would pass vacuously"
  elif grep -qE "github\.event_name" <<<"$qg_exec"; then
    fail "quality-gates.yml gates on github.event_name — that job skips on the workflow_dispatch path that unblocks bot PRs (#9161) while CI Success still reports green. Gate on a path input (see design-changed / web-changed) instead."
  else
    pass "no job in quality-gates.yml gates on github.event_name"
  fi

  # Same failure in a different shape: a step that READS the pull_request
  # payload gets empty strings on a dispatch. storybook-internal-gate diffed
  # two empty SHAs, swallowed the error with `|| echo ""`, and would have
  # reported success having built nothing.
  if grep -qE "github\.event\.pull_request" <<<"$qg_exec"; then
    fail "quality-gates.yml reads github.event.pull_request — empty on a workflow_dispatch run, so the step degrades to a silent no-op rather than failing (#9161)."
  else
    pass "no step in quality-gates.yml reads the pull_request payload"
  fi

  pin "storybook-internal-gate is gated on the design path input" \
    "$QG_YML" 'if: \$\{\{ inputs\.design-changed \}\}'
  pin "ci.yml forwards needs-design into quality-gates" \
    "$CI_YML" 'design-changed: \$\{\{ fromJSON\(needs\.ci-gate\.outputs\.needs-design\) \}\}'

  # lighthouse-delta must carry NO job-level `if:` at all. Gating it on
  # `inputs.web-changed` looks tempting and is a coverage regression:
  # `needs-web` is `^web/` only, so a packages/ui change (a runtime dependency
  # of the web build) or a root lockfile bump would skip the performance gate.
  # Path-gating it correctly is #9526 and needs an output ci-gate does not emit
  # yet. Until then, unconditional is the honest posture.
  lh_block="$(awk '/^  lighthouse-delta:$/{inblk=1; next} inblk && /^  [a-z]/{exit} inblk' "$QG_YML" | grep -v '^[[:space:]]*#')"
  if [ -z "$lh_block" ]; then
    fail "could not cut the lighthouse-delta job out of quality-gates.yml — this assertion cannot be verified (fail closed)"
  elif grep -qE "^    if:" <<<"$lh_block"; then
    # Four spaces exactly: a JOB-level key. Steps inside this job legitimately
    # carry their own deeper-indented `if:` (the @spawnforge/ui cache hit), and
    # matching those would make this assertion unsatisfiable.
    fail "lighthouse-delta carries a job-level if: — see the comment above it. An event gate skips it on the bot-branch dispatch path (#9161); a web-changed gate misses packages/ui and dependency bumps."
  else
    pass "lighthouse-delta has no job-level if: (runs on every quality-gates call)"
  fi
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All resolve-ci-diff-range.sh tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
