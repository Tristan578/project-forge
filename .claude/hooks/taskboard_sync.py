#!/usr/bin/env python3
"""Repository-scoped, transactional sync. SQLite owns identity and sync baselines.

Remote creates have a durable intent recorded BEFORE POST. An uncertain create
is recovered by its unique marker or stays blocked; it is never blindly retried.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import subprocess
import time

from taskboard_runtime import default_db, verify_database


def uid():
    alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
    value = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    return ''.join(alphabet[(value >> (5 * i)) & 31] for i in reversed(range(26)))


def stamp():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def ensure_schema(conn):
    columns = {row[1] for row in conn.execute('PRAGMA table_info(tickets)')}
    for name, kind in [('github_issue_number', 'INTEGER'), ('sync_repo', 'TEXT'), ('sync_owner', 'TEXT')]:
        if name not in columns:
            conn.execute('ALTER TABLE tickets ADD COLUMN ' + name + ' ' + kind)
    conn.execute('CREATE TABLE IF NOT EXISTS taskboard_repository_projects (repository TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE REFERENCES projects(id))')
    conn.execute('CREATE TABLE IF NOT EXISTS taskboard_sync_baselines (ticket_id TEXT PRIMARY KEY REFERENCES tickets(id), local_hash TEXT NOT NULL, remote_hash TEXT NOT NULL)')
    conn.execute('CREATE TABLE IF NOT EXISTS taskboard_create_intents (ticket_id TEXT PRIMARY KEY REFERENCES tickets(id), repository TEXT NOT NULL, marker TEXT NOT NULL UNIQUE, attempted_at TEXT NOT NULL)')
    conn.execute('CREATE TABLE IF NOT EXISTS taskboard_project_pending (ticket_id TEXT PRIMARY KEY REFERENCES tickets(id), issue_number INTEGER NOT NULL)')
    conn.execute('CREATE TABLE IF NOT EXISTS taskboard_unlinked_legacy (ticket_id TEXT PRIMARY KEY REFERENCES tickets(id))')
    # Construct the new uniqueness guard BEFORE dropping the over-broad one.
    # Existing duplicate identities abort the transaction; never delete tickets.
    conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_repo_issue ON tickets(sync_owner, sync_repo, github_issue_number) WHERE github_issue_number IS NOT NULL AND sync_owner IS NOT NULL')
    conn.execute('DROP INDEX IF EXISTS idx_tickets_github_issue')


@contextmanager
def connect(path):
    conn = sqlite3.connect(str(path), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    try:
        with conn:
            ensure_schema(conn)
        yield conn
    finally:
        conn.close()


def bind_project(conn, config):
    repository = (config['owner'] + '/' + config['repo']).lower()
    with conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT project_id FROM taskboard_repository_projects WHERE repository=?', (repository,)).fetchone()
        if row:
            return row[0]
        name = config.get('allowedProjectName', repository)
        candidates = conn.execute('SELECT id FROM projects WHERE name=? AND id NOT IN (SELECT project_id FROM taskboard_repository_projects)', (name,)).fetchall()
        # A matching project NAME only locates the container. Tickets are never
        # matched by title, remote machine-local IDs, or JSON-map cache entries.
        if len(candidates) > 1:
            raise RuntimeError('Ambiguous local project containers; bind the repository explicitly before sync')
        project = candidates[0][0] if candidates else None
        if project:
            foreign = conn.execute('SELECT 1 FROM tickets WHERE project_id=? AND (sync_repo IS NOT NULL AND sync_repo<>? OR sync_owner IS NOT NULL AND lower(sync_owner)<>?) LIMIT 1', (project, config['repo'], config['owner'].lower())).fetchone()
            if foreign:
                raise RuntimeError('Project contains another repository identity; refusing adoption')
        else:
            project = uid()
            conn.execute('INSERT INTO projects(id,name,prefix,description) VALUES(?,?,?,?)', (project, name, config.get('allowedProjectPrefix', 'PF'), 'Canonical repository: ' + repository))
        conn.execute('INSERT INTO taskboard_repository_projects VALUES(?,?)', (repository, project))
        conn.execute('INSERT OR IGNORE INTO taskboard_unlinked_legacy SELECT id FROM tickets WHERE project_id=? AND github_issue_number IS NULL', (project,))
        conn.execute('UPDATE tickets SET sync_owner=? WHERE project_id=? AND sync_repo=? AND sync_owner IS NULL', (config['owner'].lower(), project, config['repo']))
        return project


def resolve_team(conn, config):
    name = config.get('allowedTeamName') or 'Engineering'
    row = conn.execute('SELECT id FROM teams WHERE name=?', (name,)).fetchone()
    if row:
        return row[0]
    team = uid()
    conn.execute('INSERT INTO teams(id,name) VALUES(?,?)', (team, name))
    return team


def scoped_rows(conn, config, project):
    return conn.execute('SELECT * FROM tickets WHERE project_id=? AND sync_repo=? AND sync_owner=?', (project, config['repo'], config['owner'].lower())).fetchall()


def remote_view(issue):
    return {k: issue.get(k) or '' for k in ('title', 'body', 'state')}


def local_view(row):
    return {k: row[k] for k in ('title', 'description', 'status', 'priority')}


def local_hash(conn, row):
    value = local_view(row)
    value['subtasks'] = [dict(title=r['title'], completed=bool(r['completed'])) for r in conn.execute('SELECT title,completed FROM subtasks WHERE ticket_id=? ORDER BY position,id', (row['id'],))]
    return digest(value)


def remote_fields(issue):
    match = re.search(r'<!-- TASKBOARD_SYNC_FIELDS\n(.*?)\n-->', issue.get('body') or '', re.S)
    if not match:
        return {}
    fields = json.loads(match[1])
    if not isinstance(fields, dict) or fields.get('priority') not in ('low', 'medium', 'high', 'urgent'):
        raise RuntimeError('Invalid remote taskboard metadata')
    tasks = fields.get('subtasks', [])
    if not isinstance(tasks, list) or len(tasks) > 1000 or any(not isinstance(t, dict) or not isinstance(t.get('title'), str) or not isinstance(t.get('completed'), bool) for t in tasks):
        raise RuntimeError('Invalid remote subtasks')
    return fields


def published_body(conn, row):
    body = re.sub(r'\n*<!-- TASKBOARD_SYNC_FIELDS\n.*?\n-->', '', row['description'] or '', flags=re.S)
    fields = {'priority': row['priority'], 'status': row['status'], 'subtasks': [dict(title=r['title'], completed=bool(r['completed'])) for r in conn.execute('SELECT title,completed FROM subtasks WHERE ticket_id=? ORDER BY position,id', (row['id'],))]}
    return body + '\n\n<!-- TASKBOARD_SYNC_FIELDS\n' + json.dumps(fields, ensure_ascii=False) + '\n-->'


def save_baseline(conn, row, issue):
    conn.execute('INSERT OR REPLACE INTO taskboard_sync_baselines VALUES(?,?,?)', (row['id'], local_hash(conn, row), digest(remote_view(issue))))


def import_issue(conn, config, project, issue):
    """Insert ticket and repo/issue link in ONE transaction, including baseline."""
    if 'pull_request' in issue:
        return 'skipped'
    number = int(issue['number'])
    owner = config['owner'].lower()
    fields = remote_fields(issue)
    with conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT * FROM tickets WHERE sync_owner=? AND sync_repo=? AND github_issue_number=?', (owner, config['repo'], number)).fetchone()
        if row and row['project_id'] != project:
            raise RuntimeError('Issue identity belongs to a different local project')
        if row:
            base = conn.execute('SELECT * FROM taskboard_sync_baselines WHERE ticket_id=?', (row['id'],)).fetchone()
            if base and local_hash(conn, row) != base['local_hash']:
                # A local change must go through push's conflict check. Never
                # destroy it merely because a session-start pull ran first.
                return 'local-pending' if digest(remote_view(issue)) == base['remote_hash'] else 'conflict'
            status = 'done' if issue['state'] == 'closed' else (row['status'] if row['status'] in ('todo', 'in_progress') else 'todo')
            if base and digest(remote_view(issue)) == base['remote_hash']:
                return 'unchanged'
            conn.execute('UPDATE tickets SET title=?,description=?,status=?,updated_at=? WHERE id=?', (issue['title'], issue.get('body') or '', status, stamp(), row['id']))
            action = 'updated'
            ticket_id = row['id']
        else:
            ticket_id = uid()
            number_local = conn.execute('SELECT COALESCE(MAX(number),0)+1 FROM tickets WHERE project_id=?', (project,)).fetchone()[0]
            priority = 'medium'
            match = re.search(r'Priority[:*\s]+(urgent|high|medium|low)', issue.get('body') or '', re.I)
            if match:
                priority = match[1].lower()
            conn.execute('INSERT INTO tickets(id,project_id,number,title,description,status,priority,github_issue_number,sync_repo,sync_owner,team_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)', (ticket_id, project, number_local, issue['title'], issue.get('body') or '', 'done' if issue['state'] == 'closed' else 'todo', priority, int(issue['number']), config['repo'], owner, resolve_team(conn, config)))
            action = 'created'
        if fields:
            conn.execute('UPDATE tickets SET priority=? WHERE id=?', (fields['priority'], ticket_id))
            conn.execute('DELETE FROM subtasks WHERE ticket_id=?', (ticket_id,))
            for position, task in enumerate(fields.get('subtasks', [])):
                conn.execute('INSERT INTO subtasks(id,ticket_id,title,completed,position) VALUES(?,?,?,?,?)', (uid(), ticket_id, task['title'], task['completed'], position))
            if issue['state'] == 'open' and fields.get('status') in ('todo', 'in_progress'):
                conn.execute('UPDATE tickets SET status=? WHERE id=?', (fields['status'], ticket_id))
        row = conn.execute('SELECT * FROM tickets WHERE id=?', (ticket_id,)).fetchone()
        save_baseline(conn, row, issue)
        return action


class GitHub:
    def __init__(self, config):
        self.config = config
        self.repository = config['owner'] + '/' + config['repo']
        self.executable = shutil.which('gh')
        if not self.executable and os.name == 'nt':
            candidate = Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'GitHub CLI/gh.exe'
            if candidate.is_file():
                self.executable = str(candidate)
        if not self.executable:
            raise RuntimeError('Install/authenticate GitHub CLI (gh) before sync')

    def request(self, path, method='GET', body=None):
        args = [self.executable, 'api', path, '--method', method]
        if body is not None:
            args += ['--input', '-']
        result = subprocess.run(args, input=json.dumps(body) if body is not None else None, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
        if result.returncode:
            raise RuntimeError('GitHub ' + method + ' failed; authenticate gh and inspect the operation before retrying')
        return json.loads(result.stdout) if result.stdout.strip() else None

    def get(self, number):
        return self.request('repos/' + self.repository + '/issues/' + str(number))

    def issues(self, state='open'):
        page = 1
        while True:
            rows = self.request('repos/' + self.repository + '/issues?state=' + state + '&per_page=100&page=' + str(page))
            for row in rows:
                if 'pull_request' not in row:
                    yield row
            if len(rows) < 100:
                break
            page += 1

    def create(self, title, body):
        return self.request('repos/' + self.repository + '/issues', 'POST', {'title': title, 'body': body})

    def update(self, number, title, body, state):
        return self.request('repos/' + self.repository + '/issues/' + str(number), 'PATCH', {'title': title, 'body': body, 'state': state})


def create_linked(conn, config, project, row, remote):
    repository = (config['owner'] + '/' + config['repo']).lower()
    marker = '<!-- taskboard-sync:' + repository + ':' + row['id'] + ' -->'
    with conn:
        conn.execute('BEGIN IMMEDIATE')
        current = conn.execute('SELECT * FROM tickets WHERE id=?', (row['id'],)).fetchone()
        if current['project_id'] != project or current['sync_repo'] not in (None, config['repo']) or current['sync_owner'] not in (None, config['owner'].lower()):
            raise RuntimeError('Ticket does not belong to this repository')
        if current['github_issue_number'] is not None:
            return current['github_issue_number']
        if conn.execute('SELECT 1 FROM taskboard_unlinked_legacy WHERE ticket_id=?', (row['id'],)).fetchone():
            raise RuntimeError('Unlinked legacy ticket needs an explicit repository/issue link; title matching is forbidden')
        previous = conn.execute('SELECT marker FROM taskboard_create_intents WHERE ticket_id=?', (row['id'],)).fetchone()
        if not previous:
            conn.execute('INSERT INTO taskboard_create_intents VALUES(?,?,?,?)', (row['id'], repository, marker, stamp()))
    if previous:
        matches = [i for i in remote.issues('all') if marker in (i.get('body') or '')]
        if len(matches) != 1:
            raise RuntimeError('Uncertain create remains blocked; no repeat POST. Resolve the durable intent by exact marker/issue ID')
        issue = matches[0]
    else:
        issue = remote.create(row['title'], published_body(conn, row) + '\n\n' + marker)
    with conn:
        conn.execute('UPDATE tickets SET github_issue_number=?,sync_repo=?,sync_owner=? WHERE id=?', (int(issue['number']), config['repo'], config['owner'].lower(), row['id']))
        current = conn.execute('SELECT * FROM tickets WHERE id=?', (row['id'],)).fetchone()
        save_baseline(conn, current, issue)
        # A newly created issue is open. Force the next push to close a done
        # ticket without risking another create if that update fails.
        if current['status'] == 'done' and issue['state'] != 'closed':
            conn.execute("UPDATE taskboard_sync_baselines SET local_hash='' WHERE ticket_id=?", (row['id'],))
        conn.execute('INSERT OR REPLACE INTO taskboard_project_pending VALUES(?,?)', (row['id'], int(issue['number'])))
    return int(issue['number'])


def sync(conn, config, project, remote, direction, include_done=False, deadline=None):
    deadline = time.monotonic() + 120 if deadline is None else deadline
    counts = {}
    def count(key):
        counts[key] = counts.get(key, 0) + 1
    if direction == 'pull':
        seen = set()
        for issue in remote.issues():
            if time.monotonic() >= deadline:
                count('deferred')
                return counts
            seen.add(issue['number'])
            count(import_issue(conn, config, project, issue))
        # Closed linked issues remain synchronized, without importing the
        # repository's entire historical archive on every developer machine.
        for row in scoped_rows(conn, config, project):
            if time.monotonic() >= deadline:
                count('deferred')
                return counts
            if row['github_issue_number'] and row['github_issue_number'] not in seen:
                count(import_issue(conn, config, project, remote.get(row['github_issue_number'])))
        return counts
    rows = conn.execute('SELECT * FROM tickets WHERE project_id=? AND (sync_repo IS NULL OR sync_repo=?) AND (sync_owner IS NULL OR sync_owner=?)', (project, config['repo'], config['owner'].lower())).fetchall()
    for row in rows:
        if time.monotonic() >= deadline:
            count('deferred')
            break
        if row['github_issue_number'] is None:
            if row['status'] == 'done' and not include_done:
                count('local-only')
                continue
            try:
                create_linked(conn, config, project, row, remote)
                count('created-or-recovered')
            except RuntimeError as exc:
                count('blocked-create')
                print('[SYNC] ' + row['id'] + ': ' + str(exc))
            continue
        if row['sync_repo'] != config['repo'] or row['sync_owner'] != config['owner'].lower():
            count('foreign')
            continue
        base = conn.execute('SELECT * FROM taskboard_sync_baselines WHERE ticket_id=?', (row['id'],)).fetchone()
        if not base:
            count('needs-pull')
            continue
        if local_hash(conn, row) == base['local_hash']:
            count('unchanged')
            continue
        issue = remote.get(row['github_issue_number'])
        if digest(remote_view(issue)) != base['remote_hash']:
            count('conflict')
            print('[SYNC] Conflict for issue #' + str(row['github_issue_number']) + '; both sides preserved')
            continue
        issue = remote.update(row['github_issue_number'], row['title'], published_body(conn, row), 'closed' if row['status'] == 'done' else 'open')
        with conn:
            save_baseline(conn, row, issue)
            conn.execute('INSERT OR REPLACE INTO taskboard_project_pending VALUES(?,?)', (row['id'], row['github_issue_number']))
        count('updated')
    return counts


def run(module, direction, include_done=False):
    config = module.load_config()
    path = verify_database(default_db())
    # Same DB + repository means the same lock across worktrees AND clones.
    key = hashlib.sha256((config['owner'].lower() + '/' + config['repo']).encode()).hexdigest()[:24]
    with open(path.parent / ('sync-' + key + '.lock'), 'a+b') as lock:
        lock.seek(0, 2)
        if not lock.tell():
            lock.write(b'0')
            lock.flush()
        if not module._try_lock_exclusive(lock):
            print('[SYNC] Repository sync already running')
            return
        try:
            with connect(path) as conn:
                project = bind_project(conn, config)
                deadline = time.monotonic() + module.PUSH_TIME_BUDGET_SECONDS
                result = sync(conn, config, project, GitHub(config), direction, include_done, deadline)
                if direction == 'push':
                    pending = conn.execute('SELECT p.ticket_id,p.issue_number,t.status FROM taskboard_project_pending p JOIN tickets t ON t.id=p.ticket_id WHERE t.project_id=? AND t.sync_repo=? AND t.sync_owner=? LIMIT 10', (project, config['repo'], config['owner'].lower())).fetchall()
                    for row in pending:
                        if time.monotonic() >= deadline:
                            result['project-pending'] = len(pending)
                            break
                        entry = {'projectAttachmentPending': True}
                        try:
                            attached = module.retry_project_attachment(config, entry, row['issue_number'])
                            if attached and module.gh_set_status(config, entry.get('githubItemId'), row['status']):
                                with conn:
                                    conn.execute('DELETE FROM taskboard_project_pending WHERE ticket_id=?', (row['ticket_id'],))
                            else:
                                result['project-pending'] = result.get('project-pending', 0) + 1
                        except Exception:
                            result['project-pending'] = result.get('project-pending', 0) + 1
            print('[SYNC] ' + direction + ' ' + json.dumps(result, sort_keys=True))
            return result
        finally:
            module._release_lock(lock)
