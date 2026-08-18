#!/usr/bin/env bash
# Tests for github_project_sync.py — the taskboard <-> GitHub reconciliation gate.
#
# Only the PURE decision logic is covered here: classify_drift() and
# assert_not_truncated(). Everything else in that module talks to SQLite, the
# taskboard REST API, or `gh`, and is not testable without a live environment.
#
# Why these two: the sync drifted 240 tickets silently because both push() and
# pull() decide whether to act by comparing against a REMEMBERED value, so a
# single failed update latched permanently. classify_drift() is the state-based
# replacement that cannot latch, and assert_not_truncated() is what stops a
# capped listing from reporting every unseen issue as "missing" — which
# reconcile then declines to touch, silently PRESERVING the drift it exists to
# fix. Both are the kind of thing that is green until it is catastrophically
# wrong in production, so they get direct coverage.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(cd "$HERE/.." && pwd)"
MODULE="$HOOKS_DIR/github_project_sync.py"
FAILURES=0

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "SKIP-FAIL: required tool '$1' not on PATH" >&2
    exit 1
  fi
}
require python3

if [ ! -f "$MODULE" ]; then
  echo "FAIL - $MODULE not found" >&2
  exit 1
fi

# Run a python snippet with the hooks dir importable. stdout is the verdict.
run_py() {
  HOOKS_DIR="$HOOKS_DIR" python3 -c "
import os, sys, importlib
sys.path.insert(0, os.environ['HOOKS_DIR'])
m = importlib.import_module('github_project_sync')
$1
" 2>&1
}

assert_out() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "ok   - $desc"
  else
    echo "FAIL - $desc (expected '$expected', got '$actual')"
    FAILURES=$((FAILURES + 1))
  fi
}

# --------------------------------------------------------------- importable
out="$(run_py "print('imported')")"
assert_out "module imports without touching the network" "imported" "$out"

# ---------------------------------------------------- assert_not_truncated
# A listing that came back AT its own limit is indistinguishable from a
# truncated one, so it must raise rather than be treated as complete.
out="$(run_py "
try:
    m.assert_not_truncated(5000, 5000)
    print('no-raise')
except RuntimeError:
    print('raised')
")"
assert_out "row_count == limit raises (listing may be truncated)" "raised" "$out"

out="$(run_py "
try:
    m.assert_not_truncated(6000, 5000)
    print('no-raise')
except RuntimeError:
    print('raised')
")"
assert_out "row_count > limit raises" "raised" "$out"

out="$(run_py "
m.assert_not_truncated(4999, 5000)
print('ok')
")"
assert_out "row_count < limit passes" "ok" "$out"

out="$(run_py "
m.assert_not_truncated(0, 5000)
print('ok')
")"
assert_out "empty listing passes (a real answer, not a truncation)" "ok" "$out"

# ------------------------------------------------------------ classify_drift
# Shared fixture builder: one ticket per bucket, exercised in a single call so
# the buckets are proven MUTUALLY exclusive rather than each in isolation.
FIXTURE="
tickets = [
    {'id': 'a', 'number': 1, 'title': 'done local, open issue',  'status': 'done'},
    {'id': 'b', 'number': 2, 'title': 'todo local, closed issue','status': 'todo'},
    {'id': 'c', 'number': 3, 'title': 'agree done/closed',       'status': 'done'},
    {'id': 'd', 'number': 4, 'title': 'agree todo/open',         'status': 'todo'},
    {'id': 'e', 'number': 5, 'title': 'never linked',            'status': 'todo'},
    {'id': 'f', 'number': 6, 'title': 'dangling link',           'status': 'todo'},
    {'id': 'g', 'number': 7, 'title': 'not in map at all',       'status': 'todo'},
]
tmap = {
    'a': {'githubIssueNumber': 101},
    'b': {'githubIssueNumber': 102},
    'c': {'githubIssueNumber': 103},
    'd': {'githubIssueNumber': 104},
    'e': {'githubIssueNumber': None},
    'f': {'githubIssueNumber': 999},
}
states = {101: 'OPEN', 102: 'CLOSED', 103: 'CLOSED', 104: 'OPEN'}
close, done, unlinked, never = m.classify_drift(tickets, tmap, states)
ids = lambda b: ','.join(t['id'] for t, _ in b)
"

out="$(run_py "$FIXTURE
print(ids(close))")"
assert_out "ticket done + issue OPEN -> to_close" "a" "$out"

out="$(run_py "$FIXTURE
print(ids(done))")"
assert_out "issue CLOSED + ticket not done -> to_done" "b" "$out"

out="$(run_py "$FIXTURE
print(ids(never))")"
assert_out "githubIssueNumber None -> never_linked (no state to disagree with)" "e" "$out"

out="$(run_py "$FIXTURE
print(ids(unlinked))")"
assert_out "issue number absent from repo -> unlinked" "f" "$out"

# Agreement in either direction, and a ticket this sync does not own, must
# produce NO action. Proven by total count: 4 buckets, 4 entries, so c/d/g are
# in none of them.
out="$(run_py "$FIXTURE
print(len(close) + len(done) + len(unlinked) + len(never))")"
assert_out "agreeing + unmapped tickets land in no bucket" "4" "$out"

# The issue number must ride along with the ticket — reconcile closes THAT
# issue, so a bucket that dropped it would close nothing or the wrong thing.
out="$(run_py "$FIXTURE
print(close[0][1], done[0][1], unlinked[0][1])")"
assert_out "each bucket entry carries its issue number" "101 102 999" "$out"

# Idempotence is the whole point of the state-based design: once reconciled,
# a second pass must find nothing. The memo-based detector it replaced could
# not do this — a failed update latched and was never retried.
out="$(run_py "
tickets = [{'id': 'a', 'number': 1, 'title': 't', 'status': 'done'}]
tmap = {'a': {'githubIssueNumber': 101}}
c1, d1, u1, n1 = m.classify_drift(tickets, tmap, {101: 'OPEN'})
c2, d2, u2, n2 = m.classify_drift(tickets, tmap, {101: 'CLOSED'})
print(len(c1), len(c2) + len(d2) + len(u2) + len(n2))
")"
assert_out "reconciled state yields an empty second pass" "1 0" "$out"

# An empty map is the cold-start case; it must be a clean no-op, not a crash.
out="$(run_py "
c, d, u, n = m.classify_drift([{'id': 'a', 'number': 1, 'title': 't', 'status': 'done'}], {}, {})
print(len(c) + len(d) + len(u) + len(n))
")"
assert_out "empty map -> nothing to reconcile" "0" "$out"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "All github_project_sync tests passed."
  exit 0
fi
echo "$FAILURES test(s) failed."
exit 1
