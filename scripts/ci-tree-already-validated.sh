#!/usr/bin/env bash
# Decide whether the tree being deployed has ALREADY been validated by CI, so
# cd.yml can skip re-running lint / typecheck / vitest / MCP tests / the Rust
# audit / the E2E shards on a push to main.
#
# WHY THIS EXISTS
#
# cd.yml does not call quality-gates.yml on a push to main — quality-gates.yml's
# own header says so — but it reimplements the same validation as its own jobs,
# four of which carry no `if:` at all. Measured on run 33405689634 that is 24.8
# of 33.0 job-min re-testing content CI just tested, and because the block gates
# the deploys it is also most of the 17.6 min merge-to-production latency.
#
# WHY TREES, NOT SHAS
#
# The repo is squash-only. A squash merge writes a NEW commit to main that no CI
# run has ever seen, so matching on commit SHA finds nothing — the same
# constraint that makes #9525's "download CI's artifact for this SHA" unsafe.
# What IS shared is the TREE: under the ruleset's strict up-to-date requirement
# a PR must be current with main before it can merge, so the PR head's tree and
# the squashed commit's tree are the same bytes. `git rev-parse HEAD^{tree}` is
# therefore an honest join key, and comparing it is what makes a skip provable
# rather than assumed.
#
# FAIL CLOSED, ALWAYS
#
# Every path that is not a positive proof prints `validated=false` and exits 0,
# so cd.yml runs the full block. A missing PR reference, a deleted branch, an
# API error, a check that is not `success`, a tree that does not match — all of
# them mean "not proven", never "probably fine". The cost of a false negative is
# a slow deploy; the cost of a false positive is shipping an unvalidated tree to
# production. Those are not symmetric and this script does not treat them as if
# they were.
#
# It exits non-zero ONLY on a usage error (a missing repo/token), because that
# is a misconfiguration rather than an answer.
#
# TEST SEAM: $GH_CLI overrides the `gh` binary so the suite can drive every
# branch against a stub; $TREE_OVERRIDE supplies the local tree hash.
set -uo pipefail

REPO="${GITHUB_REPOSITORY:-}"
if [ -z "$REPO" ]; then
  echo "::error::ci-tree-already-validated: GITHUB_REPOSITORY is not set" >&2
  exit 64
fi

GH="${GH_CLI:-gh}"

# The check that has to be green. This is the aggregate ci.yml exposes and the
# only one the ruleset requires, so it is the single signal that means "CI
# passed for this content".
REQUIRED_CHECK="${REQUIRED_CHECK_NAME:-CI Success}"

not_validated() {
  echo "Not proven validated: $1"
  echo "validated=false"
  [ -n "${GITHUB_OUTPUT:-}" ] && echo "validated=false" >> "$GITHUB_OUTPUT"
  exit 0
}

# A workflow_dispatch is an explicit request to run the pipeline; never short
# it, whatever the tree says.
if [ "${GITHUB_EVENT_NAME:-}" = "workflow_dispatch" ]; then
  not_validated "workflow_dispatch always runs the full validation block"
fi

# --- 1. The tree being deployed ----------------------------------------------
if [ -n "${TREE_OVERRIDE:-}" ]; then
  HEAD_TREE="$TREE_OVERRIDE"
elif ! HEAD_TREE="$(git rev-parse 'HEAD^{tree}' 2>/dev/null)"; then
  not_validated "could not resolve HEAD^{tree} (is this a full checkout?)"
fi
if [[ ! "$HEAD_TREE" =~ ^[0-9a-f]{40}$ ]]; then
  not_validated "HEAD^{tree} resolved to '$HEAD_TREE', which is not an object id"
fi
echo "Tree being deployed: $HEAD_TREE"

# --- 2. Which PR produced this commit? ---------------------------------------
# GitHub's squash merge writes the subject as "<title> (#N)". Reading it costs
# one local command instead of paging through every recent CI run, and a direct
# push simply has no such reference — which is exactly the case that must fall
# through to the full block.
SUBJECT="$(git log -1 --format=%s 2>/dev/null || true)"
PR_NUMBER="$(sed -n 's/.*(#\([0-9][0-9]*\))[[:space:]]*$/\1/p' <<<"$SUBJECT")"
if [ -z "$PR_NUMBER" ]; then
  not_validated "HEAD subject carries no '(#N)' pull-request reference — treating as a direct push"
fi
echo "Merged from pull request #$PR_NUMBER"

# --- 3. That PR's head commit ------------------------------------------------
if ! PR_HEAD="$("$GH" api "repos/${REPO}/pulls/${PR_NUMBER}" --jq '.head.sha' 2>/dev/null)"; then
  not_validated "could not read pull request #$PR_NUMBER"
fi
if [[ ! "$PR_HEAD" =~ ^[0-9a-f]{40}$ ]]; then
  not_validated "pull request #$PR_NUMBER gave head sha '$PR_HEAD'"
fi

# --- 4. Did the required check pass on it? -----------------------------------
# `select(.conclusion == "success")` rather than a negated test: a check that is
# missing, queued, cancelled or failed all leave the list empty, which is the
# fail-closed answer without having to enumerate every non-success state.
if ! CONCLUSIONS="$("$GH" api "repos/${REPO}/commits/${PR_HEAD}/check-runs" \
      --jq ".check_runs[] | select(.name == \"${REQUIRED_CHECK}\") | .conclusion" 2>/dev/null)"; then
  not_validated "could not read check-runs for $PR_HEAD"
fi
if ! grep -qx 'success' <<<"$CONCLUSIONS"; then
  not_validated "'${REQUIRED_CHECK}' is not success on $PR_HEAD (saw: $(tr '\n' ' ' <<<"${CONCLUSIONS:-none}"))"
fi

# --- 5. Is it the SAME TREE? -------------------------------------------------
# The whole safety argument. A PR that was behind main when it was validated has
# a different tree from the squashed result, so it fails here and the full block
# runs — even though its check was green.
if ! PR_TREE="$("$GH" api "repos/${REPO}/commits/${PR_HEAD}" --jq '.commit.tree.sha' 2>/dev/null)"; then
  not_validated "could not read the tree of $PR_HEAD"
fi
if [ "$PR_TREE" != "$HEAD_TREE" ]; then
  not_validated "tree mismatch: deploying $HEAD_TREE, but #$PR_NUMBER was validated at $PR_TREE"
fi

echo "Proven: '${REQUIRED_CHECK}' passed on ${PR_HEAD} (#${PR_NUMBER}) for the identical tree ${HEAD_TREE}"
echo "validated=true"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "validated=true" >> "$GITHUB_OUTPUT"
exit 0
