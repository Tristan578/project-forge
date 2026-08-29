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

# ----------------------------------------- Projects v2 item-id discrimination
# REST pull uses issue-N as a correlation key. It is not a GraphQL node id and
# passing it to item-edit once per ticket was burning hundreds of requests per
# Stop hook while every mutation failed.
out="$(run_py "
values = ['PVTI_realNodeId', 'issue-9340', '', None, 9340]
print(','.join('yes' if m.is_project_item_node_id(v) else 'no' for v in values))
")"
assert_out "only real project item node ids are mutation-safe" "yes,no,no,no,no" "$out"

out="$(run_py "
calls = []
m.gh_run = lambda argv: calls.append(argv)
cfg = {'statusOptions': {'todo': 'option'}, 'projectId': 'project'}
result = m.gh_set_status(cfg, 'issue-9340', 'todo')
print(str(result).lower(), len(calls))
")"
assert_out "synthetic issue ids cause zero project mutations" "false 0" "$out"

echo
# ------------------------------------------------- review findings
# Everything below guards a defect a reviewer found in the first cut of this
# change. Each one failed silently: none of them raised, logged, or reddened a
# test — they just left the two systems disagreeing.

# --- an unreadable issue state is UNVERIFIED, not verified -----------------
# gh_get_issue_state() swallows every exception and returns None. Treating that
# as "state matches" makes the caller record the memo for a close nothing
# confirmed, which is the latch this whole change exists to remove.
out="$(run_py "
m.gh_run = lambda *a, **k: ''
m.gh_get_issue_state = lambda cfg, n: None
try:
    m.gh_sync_issue_state({'owner': 'o', 'repo': 'r'}, 7, 'done')
    print('no-raise')
except RuntimeError:
    print('raised')
")"
assert_out "unreadable issue state raises rather than passing" "raised" "$out"

out="$(run_py "
m.gh_run = lambda *a, **k: ''
m.gh_get_issue_state = lambda cfg, n: 'CLOSED'
m.gh_sync_issue_state({'owner': 'o', 'repo': 'r'}, 7, 'done')
print('ok')
")"
assert_out "a confirmed CLOSED state passes verification" "ok" "$out"

# --- every gh_sync_issue_state call is guarded ----------------------------
# The raise above is only survivable because each caller catches it. push()
# calls save_map() AFTER its ticket loop, so one uncaught raise mid-loop throws
# away every link the run recorded. Asserted structurally over the whole module
# because the offending call site sits behind a live taskboard + gh.
out="$(run_py "
import ast, os
src = open(os.path.join(os.environ['HOOKS_DIR'], 'github_project_sync.py')).read()

bare, guarded = [], []


def walk(node, protected):
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.Call) and getattr(child.func, 'id', None) == 'gh_sync_issue_state':
            (guarded if protected else bare).append(child.lineno)
        if isinstance(child, ast.Try):
            for sub in child.body:
                walk(sub, True)
            for sub in child.handlers + child.orelse + child.finalbody:
                walk(sub, protected)
        else:
            walk(child, protected)


walk(ast.parse(src), False)
total = len(bare) + len(guarded)
if total < 4:
    # A parser that silently matched nothing would otherwise report clean.
    print('parser-found-only-' + str(total))
elif bare:
    print('bare-at-' + ','.join(str(l) for l in sorted(bare)))
else:
    print('all-guarded')
")"
assert_out "every gh_sync_issue_state call sits inside a try block" "all-guarded" "$out"

# --- reconcile resolves the issue link the way push does ------------------
# push prefers SQLite's github_issue_number and falls back to the map. When
# classify_drift read the map alone, a ticket whose cached entry was stale
# reconciled against the wrong issue; one whose entry lost its number was
# skipped as "never linked" while a real issue sat open.
LINKFIX="
tickets = [{'id': 'a', 'number': 1, 'title': 't', 'status': 'done'}]
"

out="$(run_py "
$LINKFIX
tmap = {'a': {'githubIssueNumber': 111}}
states = {111: 'OPEN', 222: 'OPEN'}
close, done, unlinked, never = m.classify_drift(
    tickets, tmap, states, resolve_link=lambda tid: 222)
print(close[0][1] if close else 'none')
")"
assert_out "the database link wins over a stale map entry" "222" "$out"

out="$(run_py "
$LINKFIX
tmap = {'a': {'githubIssueNumber': 111}}
close, done, unlinked, never = m.classify_drift(
    tickets, tmap, {111: 'OPEN'}, resolve_link=lambda tid: None)
print(close[0][1] if close else 'none')
")"
assert_out "falls back to the map when the database has no link" "111" "$out"

out="$(run_py "
$LINKFIX
close, done, unlinked, never = m.classify_drift(
    tickets, {'a': {'lastLocalStatus': 'done'}}, {333: 'OPEN'},
    resolve_link=lambda tid: 333)
print(close[0][1] if close else 'none')
")"
assert_out "a map entry that lost its number still reconciles via the database" "333" "$out"

out="$(run_py "
import inspect, os
src = inspect.getsource(m.reconcile) + inspect.getsource(m._reconcile_inner)
print('wired' if 'db_get_github_issue_number' in src else 'not-wired')
")"
assert_out "reconcile wires the database resolver into classify_drift" "wired" "$out"

# --- push and reconcile share one exclusive lock --------------------------
# reconcile now runs detached from session start, so it can overlap a push.
# They write the same two systems, and reconcile decides from a snapshot of
# GitHub state that a concurrent push is busy invalidating.
# Redirect _MAIN_HOOKS to a temp dir first: taking the REAL lock here fails
# with BlockingIOError whenever a live sync (or a session that parks the lock)
# already holds it, turning an unrelated background process into a red suite.
out="$(run_py "
import fcntl, pathlib, tempfile
m._MAIN_HOOKS = pathlib.Path(tempfile.mkdtemp())
lock = open(m._MAIN_HOOKS / '.sync-push.lock', 'w')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
ran = []
m._reconcile_inner = lambda *a, **k: ran.append(1)
m.reconcile(apply_changes=True)
fcntl.flock(lock, fcntl.LOCK_UN)
lock.close()
print('ran-anyway' if ran else 'skipped')
" | tail -1)"
assert_out "reconcile skips while another sync holds the lock" "skipped" "$out"

# --- session start does not block on the full-repo listing ----------------
# reconcile lists every issue in the repo (~8k). Run inline it delayed every
# session start by that listing; it only needs to be started, not awaited.
WRAPPER="$HOOKS_DIR/sync-from-github.sh"
if grep -Eq '^[[:space:]]*(nohup[[:space:]]+)?python3 .*reconcile-apply.*&[[:space:]]*$' "$WRAPPER"; then
  echo "ok   - session-start runs reconcile-apply detached, not inline"
else
  echo "FAIL - session-start still blocks on reconcile-apply"
  FAILURES=$((FAILURES + 1))
fi

# --- reconcile stays inside this repo's tickets ---------------------------
# The taskboard holds tickets for more than one repo, and an issue number only
# means anything against the repo it was minted in. #500 exists nearly
# everywhere, so a ticket belonging to another repo read against THIS repo's
# issue list gets marked done off a closure that has nothing to do with it.
out="$(run_py "
tickets = [
    {'id': 'mine',    'number': 1, 'status': 'in_progress'},
    {'id': 'foreign', 'number': 2, 'status': 'in_progress'},
]
tmap = {
    'mine':    {'githubIssueNumber': 500},
    'foreign': {'githubIssueNumber': 500},
}
states = {500: 'CLOSED'}
close, done, unlinked, never = m.classify_drift(
    tickets, tmap, states, syncable_ids={'mine'}
)
print(','.join(sorted(t['id'] for t, _ in done)))
")"
assert_out "a ticket for another repo is not marked done off this repo's issue" "mine" "$out"

# Omitted entirely, the filter must not silently engage — every existing
# caller and test passes four arguments.
out="$(run_py "
tickets = [{'id': 'mine', 'number': 1, 'status': 'in_progress'}]
tmap = {'mine': {'githubIssueNumber': 500}}
close, done, unlinked, never = m.classify_drift(tickets, tmap, {500: 'CLOSED'})
print(len(done))
")"
assert_out "an omitted scope filters nothing" "1" "$out"

# An EMPTY scope is the database failing to read, not a repo that owns
# nothing. Reconciling zero tickets would print a clean run over a broken one.
out="$(run_py "
import inspect
src = inspect.getsource(m._reconcile_inner)
i_get = src.find('db_get_syncable_ticket_ids')
i_states = src.find('gh_get_issue_states')
print('guarded' if (i_get != -1 and i_get < i_states and 'if not syncable_ids' in src) else 'unguarded')
")"
assert_out "reconcile refuses an empty sync_repo scope before doing any work" "guarded" "$out"

out="$(run_py "
import inspect
print('wired' if 'syncable_ids=syncable_ids' in inspect.getsource(m._reconcile_inner) else 'not-wired')
")"
assert_out "reconcile wires the sync_repo scope into classify_drift" "wired" "$out"

# --- a created issue is written down before anything can fail -------------
# The issue exists on GitHub the moment gh_create_issue_and_add_to_project
# returns. Every later call in that block can raise — gh_sync_issue_state does
# so by design when it cannot verify the state it set — and the surrounding
# `except` only counts the error. If the link is not persisted first, the
# ticket looks new on the next run and push mints a SECOND issue for it,
# forever. Source order IS the invariant here: the calls are wrapped in one
# try, so nothing but their order decides what survives a failure.
out="$(run_py "
import inspect
src = inspect.getsource(m._push_inner)
# Matched as CALLS, not bare names: the comment above them names
# gh_sync_issue_state in prose, and a bare-name search would score that
# mention as the call and read the order backwards.
i_create = src.find('gh_create_issue_and_add_to_project(')
i_persist = src.find('db_set_github_issue_number(tid, new_gh_num)', i_create)
i_status  = src.find('gh_set_status(config, item_id, status)', i_create)
i_state   = src.find('gh_sync_issue_state(config, new_gh_num, status)', i_create)
ok = -1 not in (i_create, i_persist, i_status, i_state) and i_create < i_persist < i_status and i_persist < i_state
print('persist-first' if ok else 'persist-late')
")"
assert_out "push writes the new issue number down before any call that can raise" "persist-first" "$out"

if [ "$FAILURES" -eq 0 ]; then
  echo "All github_project_sync tests passed."
  exit 0
fi
echo "$FAILURES test(s) failed."
exit 1
