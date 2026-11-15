"""Behavioral regression tests for repository identity and interrupted sync."""
import copy
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import taskboard_runtime as runtime
import taskboard_sync as sync

SCHEMA = '''
CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,prefix TEXT,description TEXT DEFAULT '');
CREATE TABLE teams(id TEXT PRIMARY KEY,name TEXT);
CREATE TABLE tickets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),team_id TEXT,number INTEGER,title TEXT,description TEXT DEFAULT '',status TEXT DEFAULT 'todo',priority TEXT DEFAULT 'medium',updated_at TEXT,github_issue_number INTEGER,sync_repo TEXT);
CREATE TABLE subtasks(id TEXT PRIMARY KEY,ticket_id TEXT REFERENCES tickets(id),title TEXT,completed INTEGER,position INTEGER);
'''


class Remote:
    def __init__(self):
        self.rows = {}
        self.posts = 0
        self.patches = 0
        self.failure = None

    def issues(self, state='open'):
        return [copy.deepcopy(r) for r in self.rows.values() if state == 'all' or r['state'] == state]

    def get(self, number):
        return copy.deepcopy(self.rows[number])

    def create(self, title, body):
        self.posts += 1
        row = dict(number=100, title=title, body=body, state='open')
        if self.failure != 'before':
            self.rows[100] = row
        if self.failure:
            raise RuntimeError('connection lost')
        return copy.deepcopy(row)

    def update(self, number, title, body, state):
        self.patches += 1
        self.rows[number] = dict(number=number,title=title,body=body,state=state)
        return self.get(number)


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'board.db'
        c = sqlite3.connect(self.path)
        c.executescript(SCHEMA)
        c.close()
        self.ctx = sync.connect(self.path)
        self.c = self.ctx.__enter__()
        self.cfg = dict(owner='Owner',repo='forge',allowedProjectName='Forge',allowedProjectPrefix='PF')
        self.project = sync.bind_project(self.c,self.cfg)
        self.remote = Remote()

    def tearDown(self):
        self.ctx.__exit__(None,None,None)
        self.tmp.cleanup()

    def issue(self, number=7, title='Same title', body='Original'):
        return dict(number=number,title=title,body=body,state='open')

    def row(self):
        return self.c.execute('SELECT * FROM tickets WHERE project_id=? ORDER BY number',(self.project,)).fetchone()

    def local(self):
        with self.c:
            self.c.execute('INSERT INTO tickets(id,project_id,number,title,description) VALUES(?,?,?,?,?)',('new',self.project,1,'New','Body'))
        return self.row()

    def test_repeated_pull_is_idempotent(self):
        self.remote.rows[7]=self.issue()
        sync.sync(self.c,self.cfg,self.project,self.remote,'pull')
        sync.sync(self.c,self.cfg,self.project,self.remote,'pull')
        self.assertEqual(self.c.execute('SELECT count(*) FROM tickets').fetchone()[0],1)
        self.assertEqual(self.row()['github_issue_number'],7)
        self.assertEqual(self.remote.posts,0)

    def test_equal_titles_are_distinct_issues(self):
        for n in (7,8): sync.import_issue(self.c,self.cfg,self.project,self.issue(n))
        self.assertEqual(self.c.execute('SELECT count(*) FROM tickets').fetchone()[0],2)

    def test_equal_numbers_in_other_repos_do_not_collide(self):
        other=dict(self.cfg,repo='ember',allowedProjectName='Ember')
        pid=sync.bind_project(self.c,other)
        sync.import_issue(self.c,other,pid,self.issue(body='Other'))
        sync.import_issue(self.c,self.cfg,self.project,self.issue())
        self.assertEqual(self.c.execute('SELECT description FROM tickets WHERE project_id=?',(pid,)).fetchone()[0],'Other')
        self.assertEqual(self.c.execute('SELECT count(*) FROM tickets').fetchone()[0],2)

    def test_owner_is_part_of_repo_identity(self):
        other=dict(self.cfg,owner='Other',allowedProjectName='Other Forge')
        pid=sync.bind_project(self.c,other)
        sync.import_issue(self.c,other,pid,self.issue())
        sync.import_issue(self.c,self.cfg,self.project,self.issue())
        self.assertEqual(self.c.execute('SELECT count(*) FROM tickets').fetchone()[0],2)

    def test_same_repo_resolves_same_project(self):
        self.assertEqual(sync.bind_project(self.c,self.cfg),self.project)

    def test_remote_project_ids_and_metadata_cannot_redirect_import(self):
        issue=self.issue(body='<!-- SPAWNFORGE_METADATA {"projectId":"foreign","ticketId":"other"} -->')
        sync.import_issue(self.c,self.cfg,self.project,issue)
        self.assertEqual(self.row()['project_id'],self.project)

    def test_import_failure_rolls_back_ticket_and_link(self):
        with patch.object(sync,'save_baseline',side_effect=RuntimeError('crash')):
            with self.assertRaises(RuntimeError): sync.import_issue(self.c,self.cfg,self.project,self.issue())
        self.assertEqual(self.c.execute('SELECT count(*) FROM tickets').fetchone()[0],0)
        sync.import_issue(self.c,self.cfg,self.project,self.issue())
        self.assertEqual(self.c.execute('SELECT count(*) FROM tickets').fetchone()[0],1)

    def test_database_enforces_unique_repo_issue(self):
        sync.import_issue(self.c,self.cfg,self.project,self.issue())
        with self.assertRaises(sqlite3.IntegrityError), self.c:
            self.c.execute('INSERT INTO tickets(id,project_id,number,title,sync_owner,sync_repo,github_issue_number) VALUES(?,?,?,?,?,?,?)',('dup',self.project,2,'Other','owner','forge',7))

    def test_create_and_repeat_produce_one_remote_issue(self):
        self.local()
        for _ in range(2): sync.sync(self.c,self.cfg,self.project,self.remote,'push')
        self.assertEqual(self.remote.posts,1)
        self.assertEqual(self.row()['github_issue_number'],100)

    def test_done_ticket_create_is_closed_without_recreation(self):
        self.local()
        with self.c: self.c.execute("UPDATE tickets SET status='done'")
        for _ in range(3): sync.sync(self.c,self.cfg,self.project,self.remote,'push',include_done=True)
        self.assertEqual(self.remote.posts,1)
        self.assertEqual(self.remote.patches,1)
        self.assertEqual(self.remote.rows[100]['state'],'closed')

    def test_unlinked_legacy_ticket_cannot_create(self):
        row=self.local()
        with self.c: self.c.execute('INSERT INTO taskboard_unlinked_legacy VALUES(?)',(row['id'],))
        with self.assertRaisesRegex(RuntimeError,'explicit repository/issue link'):
            sync.create_linked(self.c,self.cfg,self.project,row,self.remote)
        self.assertEqual(self.remote.posts,0)

    def test_uncertain_create_never_blindly_reposts(self):
        row=self.local()
        self.remote.failure='before'
        with self.assertRaises(RuntimeError): sync.create_linked(self.c,self.cfg,self.project,row,self.remote)
        self.remote.failure=None
        with self.assertRaisesRegex(RuntimeError,'no repeat POST'): sync.create_linked(self.c,self.cfg,self.project,row,self.remote)
        self.assertEqual(self.remote.posts,1)

    def test_successful_create_with_lost_response_recovers_by_marker(self):
        row=self.local()
        self.remote.failure='after'
        with self.assertRaises(RuntimeError): sync.create_linked(self.c,self.cfg,self.project,row,self.remote)
        self.remote.failure=None
        number=sync.create_linked(self.c,self.cfg,self.project,row,self.remote)
        self.assertEqual(number,100)
        self.assertEqual(self.remote.posts,1)

    def test_local_edits_survive_session_start_pull(self):
        self.remote.rows[7]=self.issue()
        sync.sync(self.c,self.cfg,self.project,self.remote,'pull')
        with self.c: self.c.execute("UPDATE tickets SET description='Local correction'")
        result=sync.sync(self.c,self.cfg,self.project,self.remote,'pull')
        self.assertEqual(result,{'local-pending':1})
        self.assertEqual(self.row()['description'],'Local correction')

    def test_two_sided_change_is_conflict_not_overwrite(self):
        self.remote.rows[7]=self.issue()
        sync.sync(self.c,self.cfg,self.project,self.remote,'pull')
        with self.c: self.c.execute("UPDATE tickets SET description='Local'")
        self.remote.rows[7]['body']='Remote'
        result=sync.sync(self.c,self.cfg,self.project,self.remote,'push')
        self.assertEqual(result,{'conflict':1})
        self.assertEqual(self.remote.patches,0)
        self.assertEqual(self.row()['description'],'Local')

    def test_push_after_pull_is_noop_with_no_cache_file(self):
        self.remote.rows[7]=self.issue()
        sync.sync(self.c,self.cfg,self.project,self.remote,'pull')
        result=sync.sync(self.c,self.cfg,self.project,self.remote,'push')
        self.assertEqual(result,{'unchanged':1})
        self.assertEqual(self.remote.patches,0)

    def test_subtask_only_change_pushes_once(self):
        self.remote.rows[7]=self.issue()
        sync.sync(self.c,self.cfg,self.project,self.remote,'pull')
        with self.c: self.c.execute('INSERT INTO subtasks VALUES(?,?,?,?,?)',('s',self.row()['id'],'Step',1,0))
        for _ in range(2): sync.sync(self.c,self.cfg,self.project,self.remote,'push')
        self.assertEqual(self.remote.patches,1)
        self.assertEqual(sync.remote_fields(self.remote.rows[7])['subtasks'],[dict(title='Step',completed=True)])

    def test_closed_linked_issue_is_updated(self):
        self.remote.rows[7]=self.issue()
        sync.sync(self.c,self.cfg,self.project,self.remote,'pull')
        self.remote.rows[7]['state']='closed'
        sync.sync(self.c,self.cfg,self.project,self.remote,'pull')
        self.assertEqual(self.row()['status'],'done')

    def test_pull_does_not_import_prs(self):
        issue=dict(self.issue(),pull_request={})
        sync.import_issue(self.c,self.cfg,self.project,issue)
        self.assertEqual(self.c.execute('SELECT count(*) FROM tickets').fetchone()[0],0)

    def test_foreign_ticket_is_never_auto_tagged(self):
        with self.c: self.c.execute('INSERT INTO tickets(id,project_id,number,title,sync_repo,sync_owner) VALUES(?,?,?,?,?,?)',('foreign',self.project,2,'Same','elsewhere','other'))
        sync.sync(self.c,self.cfg,self.project,self.remote,'push')
        self.assertEqual(self.remote.posts,0)

    def test_api_database_mismatch_is_read_only_failure(self):
        with self.assertRaisesRegex(RuntimeError,'identity mismatch'):
            runtime.verify_database(self.path,[dict(id='another-db')])
        self.assertEqual(self.c.execute('SELECT count(*) FROM projects').fetchone()[0],1)

    def test_corrupt_database_is_rejected(self):
        bad=Path(self.tmp.name)/'bad.db';bad.write_bytes(b'not sqlite')
        with self.assertRaises(sqlite3.DatabaseError): runtime.verify_database(bad,[])

    def test_budget_stops_before_remote_work(self):
        self.local()
        result=sync.sync(self.c,self.cfg,self.project,self.remote,'push',deadline=0)
        self.assertEqual(result,{'deferred':1})
        self.assertEqual(self.remote.posts,0)

    def test_project_failure_does_not_repeat_issue_update(self):
        import contextlib,io,types
        self.remote.rows[7]=self.issue()
        sync.sync(self.c,self.cfg,self.project,self.remote,'pull')
        with self.c: self.c.execute("UPDATE tickets SET description='Edited'")
        attempts=[]
        def attach(config,entry,number):
            attempts.append(number)
            if len(attempts)==1: raise RuntimeError('project unavailable')
            entry['githubItemId']='PVTI_real'
            return True
        module=types.SimpleNamespace(load_config=lambda:self.cfg,_try_lock_exclusive=lambda fd:True,_release_lock=lambda fd:None,PUSH_TIME_BUDGET_SECONDS=120,retry_project_attachment=attach,gh_set_status=lambda *args:True)
        with patch.object(sync,'default_db',return_value=self.path),patch.object(sync,'verify_database',return_value=self.path),patch.object(sync,'GitHub',return_value=self.remote),contextlib.redirect_stdout(io.StringIO()):
            sync.run(module,'push')
            sync.run(module,'push')
        self.assertEqual(self.remote.patches,1)
        self.assertEqual(attempts,[7,7])
        self.assertEqual(self.c.execute('SELECT count(*) FROM taskboard_project_pending').fetchone()[0],0)

    def test_platform_paths(self):
        home=Path(self.tmp.name)/'home'
        self.assertEqual(runtime.default_db('linux',{},home),home/'.config/taskboard/taskboard.db')
        self.assertEqual(runtime.default_db('linux',{'XDG_CONFIG_HOME':'/xdg'},home),Path('/xdg/taskboard/taskboard.db'))
        self.assertEqual(runtime.default_db('darwin',{},home),home/'Library/Application Support/taskboard/taskboard.db')
        self.assertEqual(runtime.default_db('win32',{},home),home/'AppData/Roaming/taskboard/taskboard.db')
        self.assertEqual(runtime.default_db('win32',{'APPDATA':'/roaming'},home),Path('/roaming/taskboard/taskboard.db'))


if __name__ == '__main__':
    unittest.main()
