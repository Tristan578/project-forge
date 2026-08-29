#!/usr/bin/env bash
# Unit tests for scripts/notify-workflow-failure.sh — the durable failure
# notifier wired into cd.yml (both rollback paths), security-alerts.yml and
# post-deploy-smoke.yml (PF-1216 / #9438).
#
# What this suite has to prove, and why each one is load-bearing:
#
#   - A missing input EXITS NON-ZERO. The whole defect this notifier replaces
#     was a step gated on `vars.SLACK_WEBHOOK_INCIDENTS != ''`: an unset value
#     made the step SKIP, so the alerting looked wired during review and had
#     never once fired. A notifier that degrades to a silent no-op on a missing
#     input reintroduces exactly that bug in a new spelling.
#   - Dedupe COMMENTS rather than opening a second issue. security-alerts.yml
#     is a daily cron; without this it opens an issue every morning it is red.
#     pitr-verify.yml — the pattern this borrows from — has no dedupe, and the
#     board carries PF-933/PF-845/PF-762, three separate issues for the same
#     recurring failure. That is the outcome being avoided.
#   - Dedupe is scoped BY KEY. A smoke failure must not be filed as a comment on
#     the open rollback issue; per-key isolation is what makes one shared script
#     safe across four call sites.
#   - A dedupe-lookup ERROR is fatal. If a failed `gh issue list` were treated
#     as "nothing matched", every red run would open a fresh duplicate — the
#     failure mode the dedupe exists to prevent, reached through its own error
#     path.
#   - The marker is written on create. It is the only thing a later run can
#     match on, so an issue opened without it is permanently un-dedupable.
#
# The seam is a fake `gh` prepended to PATH that records its argv and replays a
# scripted stdout/exit. `jq` is used for real — the script's jq filter is part
# of what is under test.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/../notify-workflow-failure.sh"
FAILURES=0
TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T"' EXIT

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$GATE" ] || { echo "notifier not found: $GATE"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required by this suite"; exit 1; }

FAKE_BIN="$TMPDIR_T/bin"
mkdir -p "$FAKE_BIN"
ARGV_LOG="$TMPDIR_T/gh-argv.log"

# Fake gh. `gh issue list` replays $GH_LIST_STDOUT and exits $GH_LIST_EXIT;
# every other subcommand exits $GH_MUTATE_EXIT. All invocations append their
# argv to $ARGV_LOG, one line per call, so assertions can inspect what the
# script actually asked for rather than only what it printed.
cat >"$FAKE_BIN/gh" <<'FAKEGH'
#!/usr/bin/env bash
printf 'gh %s\n' "$*" >> "$ARGV_LOG"
if [ "${1:-}" = "issue" ] && [ "${2:-}" = "list" ]; then
  printf '%s' "${GH_LIST_STDOUT:-[]}"
  exit "${GH_LIST_EXIT:-0}"
fi
exit "${GH_MUTATE_EXIT:-0}"
FAKEGH
chmod +x "$FAKE_BIN/gh"

MARKER_KEY="prod-auto-rollback"
MARKER="<!-- notify-key: ${MARKER_KEY} -->"

# Run the notifier with the fake gh in front of PATH. Usage:
#   run_notify <list-json> <list-exit> <mutate-exit> [EXTRA_ENV=val ...]
# Sets globals: NOTIFY_EXIT, NOTIFY_OUT, and rewrites $ARGV_LOG.
run_notify() {
  local list_json="$1" list_exit="$2" mutate_exit="$3"; shift 3
  : > "$ARGV_LOG"
  NOTIFY_OUT="$(
    env PATH="$FAKE_BIN:$PATH" \
        ARGV_LOG="$ARGV_LOG" \
        GH_LIST_STDOUT="$list_json" \
        GH_LIST_EXIT="$list_exit" \
        GH_MUTATE_EXIT="$mutate_exit" \
        NOTIFY_KEY="$MARKER_KEY" \
        NOTIFY_TITLE="Production auto-rollback fired" \
        NOTIFY_BODY="CD rolled production back." \
        NOTIFY_LABELS="priority-p0,area-infra" \
        "$@" \
        bash "$GATE" 2>&1
  )"
  NOTIFY_EXIT=$?
}

echo "=== required inputs fail loud ==="
for missing in NOTIFY_KEY NOTIFY_TITLE NOTIFY_BODY; do
  out="$(
    env PATH="$FAKE_BIN:$PATH" ARGV_LOG="$ARGV_LOG" \
        NOTIFY_KEY="k" NOTIFY_TITLE="t" NOTIFY_BODY="b" \
        "$missing=" bash "$GATE" 2>&1
  )"
  code=$?
  if [ "$code" -eq 0 ]; then
    fail "empty \$$missing exited 0 — a missing input must never degrade to a silent skip (that is the SLACK_WEBHOOK_INCIDENTS bug this replaces)"
  elif ! grep -qF "$missing" <<<"$out"; then
    fail "empty \$$missing exited $code but the message does not name the variable"
  else
    pass "empty \$$missing exits $code and names the variable"
  fi
done

echo ""
echo "=== opens an issue when no open issue carries the key ==="
run_notify '[]' 0 0
if [ "$NOTIFY_EXIT" -ne 0 ]; then
  fail "clean create path exited $NOTIFY_EXIT: $NOTIFY_OUT"
elif ! grep -q '^gh issue create ' "$ARGV_LOG"; then
  fail "no 'gh issue create' call recorded on the empty-list path"
elif grep -q '^gh issue comment ' "$ARGV_LOG"; then
  fail "commented on the empty-list path — nothing existed to comment on"
else
  pass "opens an issue when the dedupe lookup returns nothing"
fi

# The marker is the ONLY handle a later run has; created without it, the issue
# is permanently un-dedupable and the next failure opens a second one.
if grep -qF "$MARKER" "$ARGV_LOG"; then
  pass "the created issue body carries the dedupe marker"
else
  fail "created issue body has no '$MARKER' — every later failure would open a duplicate"
fi

# The dedupe label must be on the created issue, or the label-scoped lookup
# below can never find it again.
if grep -E '^gh issue create .*--label [^ ]*ci-failure' -q "$ARGV_LOG"; then
  pass "the created issue carries the ci-failure dedupe label"
else
  fail "created issue is missing the ci-failure label — the label-scoped lookup could never find it"
fi
if grep -E '^gh issue create .*priority-p0' -q "$ARGV_LOG" && grep -E '^gh issue create .*area-infra' -q "$ARGV_LOG"; then
  pass "caller-supplied labels are passed through"
else
  fail "caller-supplied labels were dropped from the create call"
fi

echo ""
echo "=== comments instead of opening a second issue for the same key ==="
run_notify "$(jq -nc --arg m "$MARKER" '[{number: 4242, body: ("prior failure\n\n" + $m)}]')" 0 0
if [ "$NOTIFY_EXIT" -ne 0 ]; then
  fail "dedupe path exited $NOTIFY_EXIT: $NOTIFY_OUT"
elif grep -q '^gh issue create ' "$ARGV_LOG"; then
  fail "opened a NEW issue while one already tracked key '$MARKER_KEY' — this is the daily-cron duplicate spam the dedupe exists to prevent"
elif ! grep -q '^gh issue comment 4242 ' "$ARGV_LOG"; then
  fail "did not comment on the existing issue #4242"
else
  pass "comments on the existing issue rather than opening a second one"
fi

echo ""
echo "=== dedupe is scoped by key, not by label alone ==="
# An open ci-failure issue exists, but it belongs to a DIFFERENT notifier key.
# Matching it would file a production-rollback alert as a comment on the smoke
# issue, and the rollback would then have no issue of its own.
run_notify "$(jq -nc '[{number: 77, body: "unrelated\n\n<!-- notify-key: post-deploy-smoke -->"}]')" 0 0
if grep -q '^gh issue comment ' "$ARGV_LOG"; then
  fail "commented on another key's issue — dedupe is matching the label, not the key"
elif ! grep -q '^gh issue create ' "$ARGV_LOG"; then
  fail "neither commented nor created when only a foreign-key issue was open"
else
  pass "a different key's open issue does not absorb this notification"
fi

# Same shape one level finer: a body that merely mentions the key in prose,
# without the marker, must not match either.
run_notify "$(jq -nc --arg k "$MARKER_KEY" '[{number: 78, body: ("mentions " + $k + " in prose only")}]')" 0 0
if grep -q '^gh issue comment ' "$ARGV_LOG"; then
  fail "matched a body that only mentions the key in prose — the match is not anchored to the marker"
else
  pass "a prose mention of the key does not count as a marker match"
fi

echo ""
echo "=== a null body in the issue list does not abort the match ==="
# gh returns body: null for an issue opened with no body. An unguarded
# `contains` on null makes jq exit non-zero, which would empty the match and
# open a duplicate.
run_notify "$(jq -nc --arg m "$MARKER" '[{number: 1, body: null}, {number: 4242, body: $m}]')" 0 0
if grep -q '^gh issue comment 4242 ' "$ARGV_LOG"; then
  pass "a null-bodied issue earlier in the list does not block the real match"
else
  fail "a null body aborted the match — the tracked issue was missed and a duplicate would be opened"
fi

echo ""
echo "=== a failed dedupe lookup is fatal, never 'assume none exists' ==="
run_notify '' 1 0
if [ "$NOTIFY_EXIT" -eq 0 ]; then
  fail "a failed 'gh issue list' exited 0"
elif grep -q '^gh issue create ' "$ARGV_LOG"; then
  fail "opened an issue after the dedupe lookup FAILED — every red run would open a duplicate, which is the exact spam the dedupe prevents"
else
  pass "a failed dedupe lookup exits non-zero without mutating"
fi

echo ""
echo "=== a failed mutation is fatal ==="
run_notify '[]' 0 1
if [ "$NOTIFY_EXIT" -eq 0 ]; then
  fail "'gh issue create' failed but the notifier exited 0 — a broken notifier must be loud"
else
  pass "a failed create exits non-zero"
fi

run_notify "$(jq -nc --arg m "$MARKER" '[{number: 4242, body: $m}]')" 0 1
if [ "$NOTIFY_EXIT" -eq 0 ]; then
  fail "'gh issue comment' failed but the notifier exited 0"
else
  pass "a failed comment exits non-zero"
fi

echo ""
echo "=== dry run performs the lookup but no mutation ==="
run_notify '[]' 0 0 NOTIFY_DRY_RUN=1
if [ "$NOTIFY_EXIT" -ne 0 ]; then
  fail "dry run exited $NOTIFY_EXIT"
elif grep -q '^gh issue create ' "$ARGV_LOG"; then
  fail "dry run created an issue"
elif ! grep -q '^gh issue list ' "$ARGV_LOG"; then
  fail "dry run skipped the dedupe lookup — then it proves nothing about which branch would run"
elif ! grep -q 'DRY RUN' <<<"$NOTIFY_OUT"; then
  fail "dry run did not report the mutation it would have made"
else
  pass "dry run resolves the branch for real and prints the mutation instead of performing it"
fi

echo ""
echo "=== workflow wiring ==="
# The script is worthless unpointed-at. Pin that each call site still invokes
# it, and that no `vars.SLACK_WEBHOOK_INCIDENTS` guard has come back — that
# guard is the empty-string escape hatch this replaces, and it reads like
# working alerting while being dead.
WF="$HERE/../../.github/workflows"
for f in cd.yml security-alerts.yml post-deploy-smoke.yml; do
  if [ ! -f "$WF/$f" ]; then
    fail "$f not found at $WF/$f"
    continue
  fi
  if grep -q 'notify-workflow-failure.sh' "$WF/$f"; then
    pass "$f invokes the notifier"
  else
    fail "$f no longer invokes scripts/notify-workflow-failure.sh — its failures are silent again"
  fi
  # Comment-stripped: the replaced steps are documented in prose above their
  # replacements, and that prose names the dead variable on purpose. Only an
  # EXECUTABLE reference is the regression.
  if grep -v '^[[:space:]]*#' "$WF/$f" | grep -q 'SLACK_WEBHOOK_INCIDENTS'; then
    fail "$f references vars.SLACK_WEBHOOK_INCIDENTS on an executable line again — an unset repo variable makes that step SKIP, so it reads as alerting and never fires"
  else
    pass "$f carries no executable SLACK_WEBHOOK_INCIDENTS escape hatch"
  fi
done

# Each call site must declare issues: write, or the notifier 403s at runtime —
# a failure only observable during the incident it was supposed to announce.
for f in cd.yml security-alerts.yml post-deploy-smoke.yml; do
  [ -f "$WF/$f" ] || continue
  if grep -qE '^[[:space:]]*issues:[[:space:]]*write[[:space:]]*$' "$WF/$f"; then
    pass "$f declares issues: write"
  else
    fail "$f invokes the notifier without granting issues: write — it would 403 mid-incident"
  fi
done

# The notify steps must be scoped so debugging runs do not file issues.
if grep -q "github.event_name == 'schedule'" "$WF/security-alerts.yml"; then
  pass "security-alerts notify is scoped to the schedule path"
else
  fail "security-alerts notify is not scoped to github.event_name == 'schedule' — workflow_dispatch debugging would file issues"
fi
if grep -q "github.event_name == 'workflow_run'" "$WF/post-deploy-smoke.yml"; then
  pass "post-deploy-smoke notify is scoped to the workflow_run path"
else
  fail "post-deploy-smoke notify is not scoped to github.event_name == 'workflow_run' — dispatch/call debugging would file issues"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "notify-workflow-failure gate: ALL TESTS PASSED"
  exit 0
fi
echo "notify-workflow-failure gate: $FAILURES FAILURE(S)"
exit 1
