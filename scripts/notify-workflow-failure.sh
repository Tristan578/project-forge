#!/usr/bin/env bash
# Durable failure notifier for the workflows whose failures have no other
# audience (PF-1216 / #9438).
#
# Three of the pipeline's highest-signal failure events used to produce nothing
# outside the Actions tab:
#
#   1. cd.yml's production auto-rollback and manual rollback. Both had a Slack
#      step gated on `vars.SLACK_WEBHOOK_INCIDENTS != ''`, and that repo
#      variable has never existed (`gh variable list` returns four variables,
#      none of them it). An empty-string guard SKIPS rather than errors, so the
#      misconfiguration never surfaced: the steps read like working alerting
#      during review and were dead in every run.
#   2. security-alerts.yml, a daily cron whose only output is a red run.
#   3. post-deploy-smoke.yml's `workflow_run` path, which fires only after CD
#      SUCCEEDED — so its failure means production is broken behind a green
#      deploy, and `workflow_run` conclusions are invisible from the CD run's
#      own status.
#
# This script replaces all of that with one mechanism that has no
# empty-string escape hatch: a missing input is exit 2 with a named cause, not
# a silent skip. It opens a GitHub issue, or comments on the one it already
# opened for the same recurring failure.
#
# Deduplication. Every issue this script opens carries the DEDUPE_LABEL and a
# hidden marker line naming the caller's key. On a later failure with the same
# key it finds that issue and comments instead of opening a second one, so the
# daily security-alerts cron produces one issue with a comment per red morning
# rather than an issue per morning. The lookup filters by label and matches the
# marker in the body LOCALLY — GitHub's search index does not reliably index
# HTML-comment text, so `--search "<!-- ... -->" in:body` would silently miss
# and re-open a duplicate every run.
#
# Unit-tested by scripts/__tests__/notify-workflow-failure.test.sh (run in
# ci.yml's CI Self-Defense Tests job) against a recording fake `gh`.
#
# Inputs (environment):
#   NOTIFY_KEY     required  stable dedupe key, e.g. "security-alerts-cron"
#   NOTIFY_TITLE   required  issue title (used only when opening a new issue)
#   NOTIFY_BODY    required  issue body, and the comment body on a repeat
#   NOTIFY_LABELS  optional  comma-separated labels; all must already exist
#   NOTIFY_DRY_RUN optional  "1" prints the mutation instead of performing it;
#                            the dedupe lookup still runs for real
#
# Requires GH_TOKEN with `issues: write` on the repo.
set -uo pipefail

# Scopes the dedupe lookup. Every issue opened here gets it, so the lookup is a
# label filter plus a local marker match rather than a full-repo issue scan.
DEDUPE_LABEL="ci-failure"

die() {
  echo "::error::notify-workflow-failure: $1" >&2
  exit 2
}

require() {
  local name="$1"
  # Indirect expansion, guarded so `set -u` cannot abort before the message.
  [ -n "${!name:-}" ] || die "\$$name is empty or unset. This notifier fails loud on purpose — a missing input must never degrade to a silent skip (that is the bug it exists to fix)."
}

require NOTIFY_KEY
require NOTIFY_TITLE
require NOTIFY_BODY

command -v gh >/dev/null 2>&1 || die "the gh CLI is not on PATH"

MARKER="<!-- notify-key: ${NOTIFY_KEY} -->"

# Assemble the label list. DEDUPE_LABEL is always present, and is not repeated
# if the caller also asked for it.
labels="$DEDUPE_LABEL"
if [ -n "${NOTIFY_LABELS:-}" ]; then
  IFS=',' read -r -a extra <<<"$NOTIFY_LABELS"
  for l in "${extra[@]}"; do
    l="${l#"${l%%[![:space:]]*}"}"
    l="${l%"${l##*[![:space:]]}"}"
    [ -n "$l" ] || continue
    [ "$l" = "$DEDUPE_LABEL" ] && continue
    labels="${labels},${l}"
  done
fi

# --- Dedupe lookup ------------------------------------------------------------
# A lookup failure is fatal, not "assume none exists": treating an API error as
# "no match" would open a fresh issue on every red run, which is the duplicate
# spam this dedupe exists to prevent.
if ! existing_json="$(gh issue list --state open --label "$DEDUPE_LABEL" --limit 100 --json number,body 2>&1)"; then
  die "could not list open '$DEDUPE_LABEL' issues: $existing_json"
fi

# --arg (not string interpolation) so a key containing jq-significant or
# shell-significant characters cannot alter the filter.
existing="$(printf '%s' "$existing_json" \
  | jq -r --arg m "$MARKER" 'map(select(.body != null and (.body | contains($m)))) | .[0].number // empty' 2>/dev/null)"

# --- Mutation -----------------------------------------------------------------
if [ -n "$existing" ]; then
  echo "notify-workflow-failure: key '$NOTIFY_KEY' already tracked by issue #$existing — commenting."
  if [ "${NOTIFY_DRY_RUN:-}" = "1" ]; then
    echo "DRY RUN: gh issue comment $existing --body <body>"
    exit 0
  fi
  gh issue comment "$existing" --body "$NOTIFY_BODY" >/dev/null || die "failed to comment on issue #$existing"
  echo "Commented on issue #$existing"
  exit 0
fi

echo "notify-workflow-failure: no open issue for key '$NOTIFY_KEY' — opening one."
if [ "${NOTIFY_DRY_RUN:-}" = "1" ]; then
  echo "DRY RUN: gh issue create --title '$NOTIFY_TITLE' --label '$labels' --body <body + marker>"
  exit 0
fi

# The marker goes last so it never displaces the human-readable body.
gh issue create \
  --title "$NOTIFY_TITLE" \
  --label "$labels" \
  --body "${NOTIFY_BODY}

${MARKER}" || die "failed to open issue for key '$NOTIFY_KEY'"
