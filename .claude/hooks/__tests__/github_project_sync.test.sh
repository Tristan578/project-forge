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
# Redirect the lock paths to a temp dir first: taking the REAL lock here fails
# whenever a live sync (or a session that parks the lock) already holds it,
# turning an unrelated background process into a red suite.
#
# Patch LOCK_PATH / LOCK_WANTED_PATH, NOT _MAIN_HOOKS. Both are module-level
# constants resolved from _MAIN_HOOKS at IMPORT time, so reassigning
# _MAIN_HOOKS afterwards is inert — the module goes on using the real
# .claude/hooks paths. That mistake did not fail: it passed on a machine whose
# session was parking the real lock and reported 'ran-anyway' on CI, i.e. it
# graded the developer's environment rather than the code.
#
# The lock is held by a genuine CHILD PROCESS, not by a second descriptor in
# this one. flock(2) only specifies that a same-process conflict on a second
# open file description "may be denied" — the kernels disagree, and a second
# process is also the situation the lock exists to handle.
#
# Three witnesses ship alongside the verdict so it can never pass vacuously:
# 'locked' proves the child really holds the lock before reconcile is called,
# 'denied' proves THIS process is refused that same lock (so the platform
# honours cross-process flock at all, and the path under test is the one the
# module uses), and 'noted' proves the skip left the lock-wanted note behind —
# the note is what stops the long reconcile sweep from starving the Stop-hook
# push it is blocking.
out="$(run_py "
import fcntl, pathlib, subprocess, sys, tempfile
tmp = pathlib.Path(tempfile.mkdtemp())
m.LOCK_PATH = tmp / '.sync-push.lock'
m.LOCK_WANTED_PATH = tmp / '.sync-lock-wanted'
lock_path = str(m.LOCK_PATH)
child_src = (
    'import fcntl, os, sys\n'
    'fd = os.open(sys.argv[1], os.O_CREAT | os.O_WRONLY)\n'
    'fcntl.flock(fd, fcntl.LOCK_EX)\n'
    'sys.stdout.write(\'locked\')\n'
    'sys.stdout.flush()\n'
    'sys.stdin.readline()\n'
)
child = subprocess.Popen(
    [sys.executable, '-c', child_src, lock_path],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
handshake = child.stdout.read(6)
probe = 'granted'
try:
    probe_fd = open(lock_path, 'w')
    fcntl.flock(probe_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    fcntl.flock(probe_fd, fcntl.LOCK_UN)
    probe_fd.close()
except (IOError, OSError):
    probe = 'denied'
ran = []
m._reconcile_inner = lambda *a, **k: ran.append(1)
m.reconcile(apply_changes=True)
child.stdin.write('go')
child.stdin.close()
child.wait(timeout=10)
print('%s+%s+%s+%s' % (
    handshake,
    probe,
    'ran-anyway' if ran else 'skipped',
    'noted' if m.LOCK_WANTED_PATH.exists() else 'no-note'))
" | tail -1)"
assert_out "reconcile skips while another sync holds the lock" "locked+denied+skipped+noted" "$out"

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

# --- issue creation is REST and persisted before Projects v2 is touched ----
# GraphQL quota exhaustion must neither block the authoritative REST create nor
# make a project-add failure replay that create on the next push.
out="$(run_py "
import contextlib, io, json
events = []
def fake_gh(args, **kwargs):
    events.append(('gh', args))
    if args[:2] == ['gh', 'api']:
        return json.dumps({'number': 8937, 'html_url': 'https://github.com/o/r/issues/8937'})
    raise RuntimeError('GraphQL quota exhausted')
m.gh_run = fake_gh
m.db_set_github_issue_number = lambda tid, num: events.append(('persist', tid, num))
with contextlib.redirect_stderr(io.StringIO()) as err:
    item_id, issue_number = m.gh_create_issue_and_add_to_project(
        {'owner': 'o', 'repo': 'r', 'projectNumber': 1}, 'ticket-id', 'title', 'body', ['bug'])
create_args = events[0][1]
print(
    create_args[:4] == ['gh', 'api', 'repos/o/r/issues', '--method'],
    '--raw-field' in create_args,
    'labels[]=bug' in create_args,
    events[1] == ('persist', 'ticket-id', 8937),
    events[2][1][1:3] == ['project', 'item-add'],
    item_id is None,
    issue_number,
    'created, but project add failed' in err.getvalue(),
)
")"
assert_out "REST create is persisted before a non-fatal GraphQL project-add failure" \
  "True True True True True True 8937 True" "$out"

out="$(run_py "
import json
calls = []
m.gh_run = lambda args, **kwargs: (
    json.dumps({'number': 42, 'html_url': 'https://github.com/o/r/issues/42'})
    if args[:2] == ['gh', 'api'] else json.dumps({'id': 'PVTI_real'})
)
m.db_set_github_issue_number = lambda tid, num: calls.append((tid, num))
item_id, issue_number = m.gh_create_issue_and_add_to_project(
    {'owner': 'o', 'repo': 'r', 'projectNumber': 1}, 'tid', 'title')
print(item_id, issue_number, calls)
")"
assert_out "successful project add still returns its real item id" \
  "PVTI_real 42 [('tid', 42)]" "$out"

out="$(run_py "
import json
calls = []
entry = {'projectAttachmentPending': True}
def fake_gh(args, **kwargs):
    calls.append(args)
    return json.dumps({'id': 'PVTI_attached'})
m.gh_run = fake_gh
m.gh_resolve_project_item_id = lambda *args: None
ok = m.retry_project_attachment(
    {'owner': 'o', 'repo': 'r', 'projectNumber': 1}, entry, 42)
print(ok, entry, len(calls), calls[0][1:3])
")"
assert_out "second run attaches the existing issue without another REST create" \
  "True {'githubItemId': 'PVTI_attached'} 1 ['project', 'item-add']" "$out"

out="$(run_py "
import contextlib, io, json
calls = []
entry = {'githubItemId': 'PVTI_legacy', 'projectAttachmentPending': True}
delete_attempts = 0
def fake_gh(args, **kwargs):
    global delete_attempts
    calls.append(args)
    if args[1:3] == ['project', 'item-add']:
        return json.dumps({'id': 'PVTI_replacement'})
    delete_attempts += 1
    if delete_attempts == 1:
        raise RuntimeError('temporary delete failure')
    return ''
m.gh_run = fake_gh
m.gh_resolve_project_item_id = lambda *args: None
with contextlib.redirect_stderr(io.StringIO()):
    first = m.retry_project_attachment(
        {'owner': 'o', 'repo': 'r', 'projectNumber': 1}, entry, 42)
    second = m.retry_project_attachment(
        {'owner': 'o', 'repo': 'r', 'projectNumber': 1}, entry, 42)
adds = sum(args[1:3] == ['project', 'item-add'] for args in calls)
deletes = sum(args[1:3] == ['project', 'item-delete'] for args in calls)
print(first, second, entry, adds, deletes)
")"
assert_out "legacy cleanup retries without adding the existing issue twice" \
  "False True {'githubItemId': 'PVTI_replacement'} 1 2" "$out"

# ==========================================================================
# PF-1212 — the sync must not spend GraphQL quota on requests that cannot
# succeed. pull() synthesized `issue-<number>` as a Projects v2 item id, push()
# fed it straight to `gh project item-edit --id`, and GitHub answered "Could not
# resolve to a node" every time. The raise aborted the ticket's update block
# BEFORE its memo fields were written, so the change detector fired again next
# run: 922 tickets x one failing billed mutation each, once per Stop hook.
# ==========================================================================

# ------------------------------------------------- is_real_project_item_id
out="$(run_py "
cases = ['PVTI_lADOAA', 'issue-9340', 'issue-1', '', None, 0, 'I_kwDOROP26c', 'PVT_kwDO']
print(' '.join(str(m.is_real_project_item_id(c)) for c in cases))
")"
assert_out "only PVTI_-prefixed node ids are accepted as project item ids" \
  "True False False False False False False False" "$out"

# The guard lives INSIDE gh_set_status, not at its call sites: every path into
# the Status mutation goes through it, so a future caller cannot route around
# the check. Proven by observing that `gh` is never invoked.
#
# The refusal is a False return, NOT a raise (#9429). Raising here is what
# aborted the ticket's update block before its memo fields were written, so the
# change detector fired again on the very next run and replayed the whole board.
out="$(run_py "
calls = []
m.gh_run = lambda *a, **k: calls.append(a)
cfg = {'statusOptions': {'todo': 'opt1'}, 'projectId': 'PVT_x', 'statusFieldId': 'F_x'}
try:
    result = m.gh_set_status(cfg, 'issue-9340', 'todo')
    print('refused-without-calling-gh' if result is False and not calls else 'leaked')
except Exception:
    print('raised')
")"
assert_out "gh_set_status refuses a synthetic item id without spending a request" \
  "refused-without-calling-gh" "$out"

out="$(run_py "
calls = []
m.gh_run = lambda *a, **k: calls.append(a)
cfg = {'statusOptions': {'todo': 'opt1'}, 'projectId': 'PVT_x', 'statusFieldId': 'F_x'}
m.gh_set_status(cfg, 'PVTI_real', 'todo')
print(len(calls))
")"
assert_out "gh_set_status still issues the mutation for a real node id" "1" "$out"

# ------------------------------------------- map serialization strips them
# The map is a cache, so the 922 stand-ins already on disk are purged by
# loading it. Stripping on BOTH load and save is deliberate: pull() writes
# githubItemId from four separate branches, and a guard at any one of them is
# one refactor away from being bypassed — the serialization boundary is not.
out="$(run_py "
import json, tempfile, pathlib
tmp = pathlib.Path(tempfile.mkdtemp()) / 'map.json'
tmp.write_text(json.dumps({'tickets': {
    'a': {'githubItemId': 'issue-1', 'githubIssueNumber': 1},
    'b': {'githubItemId': 'PVTI_keep', 'githubIssueNumber': 2},
}}))
m.MAP_PATH = tmp
loaded = m.load_map()
print('githubItemId' not in loaded['tickets']['a'], loaded['tickets']['b']['githubItemId'])
")"
assert_out "load_map drops synthetic item ids and keeps real ones" "True PVTI_keep" "$out"

out="$(run_py "
import json, tempfile, pathlib
tmp = pathlib.Path(tempfile.mkdtemp()) / 'map.json'
m.MAP_PATH = tmp
m.save_map({'tickets': {'a': {'githubItemId': 'issue-7'}, 'b': {'githubItemId': 'PVTI_keep'}}})
back = json.loads(tmp.read_text())
print('githubItemId' in back['tickets']['a'], back['tickets']['b']['githubItemId'])
")"
assert_out "save_map refuses to persist a synthetic item id" "False PVTI_keep" "$out"

# ------------------------------------------------------- ProjectFieldSync
# The board Status field MIRRORS the ticket status; the issue open/closed state
# is the load-bearing signal and is verified separately. So a field failure must
# be counted, never raised — raising is what aborted the update block before the
# memo was written and latched the whole board into replaying every run.
out="$(run_py "
import io, contextlib
fs = m.ProjectFieldSync()
def boom(*a, **k):
    raise RuntimeError('GraphQL: Could not resolve to a node with the global id of \'issue-42\'')
m.gh_set_status = boom
entry = {'githubItemId': 'PVTI_stale'}
with contextlib.redirect_stderr(io.StringIO()):
    fs.apply({'projectId': 'PVT_x'}, entry, 42, 'todo', 'PF-1')
print('no-raise', fs.tripped, fs.failures, 'githubItemId' in entry)
")"
assert_out "an unresolvable-node failure trips the breaker on the FIRST occurrence" \
  "no-raise True 1 False" "$out"

# Once tripped, the rest of the run issues no further field mutations at all.
out="$(run_py "
import io, contextlib
fs = m.ProjectFieldSync()
calls = []
def boom(*a, **k):
    calls.append(a)
    raise RuntimeError('GraphQL: Could not resolve to a node with the global id')
m.gh_set_status = boom
with contextlib.redirect_stderr(io.StringIO()):
    for i in range(50):
        fs.apply({'projectId': 'PVT_x'}, {'githubItemId': 'PVTI_stale'}, i, 'todo', 'PF-%d' % i)
print(len(calls))
")"
assert_out "a tripped breaker stops every later field mutation in the run" "1" "$out"

# An ordinary (non-systemic) failure gets a small budget rather than one shot.
out="$(run_py "
import io, contextlib
fs = m.ProjectFieldSync()
calls = []
def boom(*a, **k):
    calls.append(a)
    raise RuntimeError('HTTP 502 bad gateway')
m.gh_set_status = boom
with contextlib.redirect_stderr(io.StringIO()):
    for i in range(50):
        fs.apply({'projectId': 'PVT_x'}, {'githubItemId': 'PVTI_x'}, i, 'todo', 'PF-%d' % i)
print(len(calls) == m.PROJECT_FIELD_FAILURE_LIMIT, fs.tripped)
")"
assert_out "a transient failure trips only after the per-run failure limit" "True True" "$out"

# An issue that was never added to the board has no field to write. That is a
# no-op, not an error — counting it as one would make a clean run look broken.
out="$(run_py "
fs = m.ProjectFieldSync()
m.gh_resolve_project_item_id = lambda *a, **k: None
def never(*a, **k):
    raise AssertionError('must not be called')
m.gh_set_status = never
entry = {}
fs.apply({'projectId': 'PVT_x'}, entry, 42, 'todo', 'PF-1')
print(fs.unmapped, fs.failures, entry)
")"
assert_out "an issue that is not on the board is a no-op, not an error" "1 0 {}" "$out"

# A resolved id is cached on the entry so the next status change costs no query.
out="$(run_py "
fs = m.ProjectFieldSync()
resolved = []
def resolve(*a, **k):
    resolved.append(a)
    return 'PVTI_resolved'
m.gh_resolve_project_item_id = resolve
m.gh_set_status = lambda *a, **k: True
entry = {}
fs.apply({'projectId': 'PVT_x'}, entry, 42, 'todo', 'PF-1')
fs.apply({'projectId': 'PVT_x'}, entry, 42, 'done', 'PF-1')
print(len(resolved), entry['githubItemId'], fs.applied)
")"
assert_out "a resolved item id is cached on the map entry" "1 PVTI_resolved 2" "$out"

# --- the update path must not be able to latch on a field failure ---------
# gh_set_status raises by design for an id GitHub cannot resolve, and the update
# block's memo writes come after it. Routing the status mirror through
# ProjectFieldSync.apply (which never raises) is what stops one board failure
# from replaying the ticket on every push forever. The single remaining direct
# call is the create path, where item-add has just returned a real id.
out="$(run_py "
import inspect
src = inspect.getsource(m._push_inner)
routed = 'field_sync.apply(config, entry, gh_issue_num, status, display)' in src
print('routed' if routed and src.count('gh_set_status(') == 1 else 'direct')
")"
assert_out "push mirrors board status through the non-raising helper" "routed" "$out"

# ------------------------------------------------------------ run budgets
out="$(run_py "
import inspect
src = inspect.getsource(m._push_inner)
i_loop = src.find('for index, ticket in enumerate(tickets):')
i_budget = src.find('PUSH_TIME_BUDGET_SECONDS', i_loop)
i_work = src.find('tid = ticket[', i_loop)
print('bounded' if -1 not in (i_loop, i_budget, i_work) and i_budget < i_work else 'unbounded')
")"
assert_out "push checks its wall-clock budget before each ticket's work" "bounded" "$out"

out="$(run_py "
import inspect
src = inspect.getsource(m._reconcile_inner)
print('yields' if 'sync_lock_wanted()' in src and 'RECONCILE_TIME_BUDGET_SECONDS' in src else 'starves')
")"
assert_out "reconcile yields to a waiting push and bounds its own wall clock" "yields" "$out"

# The note a skipped run leaves behind is what lets the long detached sweep
# learn that it is blocking an interactive push. Without it the sweep has no
# way to see the Stop-hook pushes it starves, one per assistant response.
out="$(run_py "
import inspect
print('notes' if 'request_sync_lock()' in inspect.getsource(m.with_sync_lock) else 'silent')
")"
assert_out "a run that cannot take the lock records that it wanted it" "notes" "$out"

out="$(run_py "
import tempfile, pathlib
m.LOCK_WANTED_PATH = pathlib.Path(tempfile.mkdtemp()) / 'wanted'
print(m.sync_lock_wanted(), end=' ')
m.request_sync_lock()
print(m.sync_lock_wanted(), end=' ')
m.clear_sync_lock_request()
print(m.sync_lock_wanted())
")"
assert_out "the lock-wanted note is set and cleared" "False True False" "$out"

# A stale note must not make every future sweep yield instantly forever.
out="$(run_py "
import tempfile, pathlib, time
p = pathlib.Path(tempfile.mkdtemp()) / 'wanted'
m.LOCK_WANTED_PATH = p
p.write_text(str(time.time() - m.LOCK_WANTED_TTL_SECONDS - 60))
print(m.sync_lock_wanted())
")"
assert_out "a note older than its TTL stops forcing a yield" "False" "$out"

# ---------------------------------------------------------- BoundedErrorLog
# 894 identical stderr lines is how a systemic failure came to read as ordinary
# log noise for weeks. The first few carry the diagnosis, the count the scale.
out="$(run_py "
import io, contextlib
log = m.BoundedErrorLog(limit=3)
buf = io.StringIO()
with contextlib.redirect_stderr(buf):
    for i in range(100):
        log.add('failure %d' % i)
lines = [l for l in buf.getvalue().splitlines() if l.strip()]
print(len(lines), log.count, log.summary('errors'))
")"
assert_out "an error log prints a bounded head and counts the tail" \
  "4 100 100 errors (first 3 shown)" "$out"

out="$(run_py "print(repr(m.BoundedErrorLog().summary('errors')))")"
assert_out "a clean run contributes no error text to the summary" "''" "$out"

# -------------------------------------------------------------- kill switch
out="$(run_py "
import os, tempfile, pathlib
os.environ.pop('SPAWNFORGE_SYNC_DISABLED', None)
m.DISABLE_MARKER = pathlib.Path(tempfile.mkdtemp()) / '.sync-disabled'
print(m.sync_disabled_reason())
")"
assert_out "sync is enabled by default" "None" "$out"

out="$(run_py "
import os, tempfile, pathlib
m.DISABLE_MARKER = pathlib.Path(tempfile.mkdtemp()) / '.sync-disabled'
os.environ['SPAWNFORGE_SYNC_DISABLED'] = '1'
print(m.sync_disabled_reason() is not None, end=' ')
os.environ['SPAWNFORGE_SYNC_DISABLED'] = '0'
print(m.sync_disabled_reason())
")"
assert_out "the env kill switch honours an explicit 0 as 'not disabled'" "True None" "$out"

out="$(run_py "
import os, tempfile, pathlib
os.environ.pop('SPAWNFORGE_SYNC_DISABLED', None)
marker = pathlib.Path(tempfile.mkdtemp()) / '.sync-disabled'
marker.write_text('PF-1212 investigation')
m.DISABLE_MARKER = marker
print('PF-1212 investigation' in m.sync_disabled_reason())
")"
assert_out "the marker file kill switch reports the note written into it" "True" "$out"

# The switch must be honoured by every entry point, not just the Stop hook.
# A switch some paths ignore is not a switch.
for wrapper in sync-to-github.sh sync-from-github.sh; do
  script="$HOOKS_DIR/$wrapper"
  # Comment-stripped: a mention in prose is not a check.
  body="$(sed 's/#.*//' "$script")"
  if grep -q '\.sync-disabled' <<<"$body" && grep -q 'SPAWNFORGE_SYNC_DISABLED' <<<"$body"; then
    echo "ok   - $wrapper honours both kill-switch signals"
  else
    echo "FAIL - $wrapper does not check both kill-switch signals"
    FAILURES=$((FAILURES + 1))
  fi
  # ...and it must come first: probing gh/curl before the switch means a
  # disabled sync still shells out on every assistant response.
  i_switch="$(grep -n 'sync-disabled' <<<"$body" | head -1 | cut -d: -f1)"
  i_gh="$(grep -n 'command -v gh' <<<"$body" | head -1 | cut -d: -f1)"
  if [ -n "$i_switch" ] && [ -n "$i_gh" ] && [ "$i_switch" -lt "$i_gh" ]; then
    echo "ok   - $wrapper checks the kill switch before doing any work"
  else
    echo "FAIL - $wrapper checks the kill switch too late (switch=$i_switch gh=$i_gh)"
    FAILURES=$((FAILURES + 1))
  fi
done

# End to end through the real script: a disabled pull must announce itself and
# exit clean without touching gh or the taskboard.
out="$(SPAWNFORGE_SYNC_DISABLED=1 bash "$HOOKS_DIR/sync-from-github.sh" 2>&1)"
rc=$?
if [ "$rc" -eq 0 ] && grep -q 'disabled' <<<"$out"; then
  echo "ok   - a disabled sync-from-github.sh exits 0 and says so"
else
  echo "FAIL - a disabled sync-from-github.sh (rc=$rc) did not report the switch: $out"
  FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -eq 0 ]; then
  echo "All github_project_sync tests passed."
  exit 0
fi
echo "$FAILURES test(s) failed."
exit 1
