"""Regression coverage for #9995: HTTP, MCP and the sync script must all
resolve the SAME taskboard database, through the SAME function
(`taskboard_runtime.default_db()`), with no client falling back to its own
independent default.

The historical failure mode was not "the function disagrees with itself" —
`default_db()` is deterministic — it was "one of the three call sites stops
calling it," either by never passing an explicit path to a subprocess (which
then falls back to ITS OWN platform default, `taskboard_runtime.py`'s win32
comment documents this exact divergence) or by re-implementing path
resolution locally instead of delegating. Every test here mutates the
call site, not the shared function, and asserts against the REAL command
line / REAL cross-process import — a unit test that only calls
`default_db()` twice and compares the results would pass even if the
regression this ticket describes were reintroduced.
"""
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HOOKS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HOOKS_DIR))
import taskboard_runtime as runtime  # noqa: E402


def _plant_default_db(env, config_root):
    """Point default_db()'s PLATFORM fallback (TASKBOARD_DB unset) at
    `config_root` and create the database file there.

    ensure_running() refuses to spawn the binary for a database that does not
    exist (see MissingDatabaseIsNeverCreated), so a test that wants to observe
    the spawn arguments must give it a real file — without reaching for
    TASKBOARD_DB, because the case under test is precisely "no override set".
    Each platform's own config-root variable is redirected, so default_db()'s
    real branch for this host still runs.
    """
    env.pop('TASKBOARD_DB', None)
    if sys.platform == 'win32':
        env['APPDATA'] = str(config_root)
    elif sys.platform == 'darwin':
        env['HOME'] = str(config_root)
    else:
        env['XDG_CONFIG_HOME'] = str(config_root)
    expected = runtime.default_db(environ=env, home=config_root)
    expected.parent.mkdir(parents=True, exist_ok=True)
    expected.touch()
    return expected


def _run_py(script, env_overrides=None):
    """Run `script` in a FRESH subprocess with the hooks dir importable.

    A fresh process is required for the sync-script test: DB_PATH is computed
    once at import time, so patching the already-imported module in-process
    proves nothing about what a real, separate invocation would resolve.
    """
    env = dict(os.environ)
    env.update(env_overrides or {})
    result = subprocess.run(
        [sys.executable, '-c', script],
        cwd=str(HOOKS_DIR),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return result


class HttpStartupAlwaysPassesExplicitPath(unittest.TestCase):
    """The HTTP server: ensure_running() must launch the binary with the
    resolved path explicitly, in every case, not only when TASKBOARD_DB is
    set — otherwise the binary falls back to its own default the moment the
    launching environment does not carry APPDATA/HOME the way Python's
    default_db() does.
    """

    def _captured_start_args(self, taskboard_db=None):
        captured = {}

        def fake_run(args, **kwargs):
            captured['args'] = args
            return subprocess.CompletedProcess(args, 0)

        # Keep the REAL environment intact except for the ONE variable each
        # case is about, so default_db()'s platform logic runs for real,
        # exactly as it would for a real client — but with its result
        # redirected into a temp root where the database file can exist
        # (ensure_running() refuses to spawn for a missing file). Compute the
        # expected path from this SAME env dict, inside the patched context,
        # rather than calling default_db() again afterwards against the
        # restored (unpatched) os.environ — the two would silently disagree
        # whenever taskboard_db is set, defeating the assertion.
        env = dict(os.environ)
        with tempfile.TemporaryDirectory() as tmp:
            if taskboard_db is None:
                _plant_default_db(env, Path(tmp))
            else:
                explicit = Path(tmp) / taskboard_db
                explicit.touch()
                env['TASKBOARD_DB'] = str(explicit)

            with patch.object(runtime, 'binary', return_value='FAKE_TASKBOARD_BIN'), \
                 patch.object(runtime, 'api', side_effect=[OSError('not running'), [{'id': 'p1'}]]), \
                 patch.object(runtime.subprocess, 'run', side_effect=fake_run), \
                 patch.object(runtime, 'verify_database', return_value=None), \
                 patch.dict(runtime.os.environ, env, clear=True):
                runtime.ensure_running()
                expected = runtime.default_db()
        return captured['args'], expected

    def test_db_flag_present_without_taskboard_db_env(self):
        # This is the actual production case: TASKBOARD_DB is normally unset.
        args, expected = self._captured_start_args(None)
        self.assertIn('--db', args, 'start command must always pin --db, not only when TASKBOARD_DB is set')
        self.assertEqual(args[args.index('--db') + 1], str(expected))

    def test_db_flag_present_with_taskboard_db_env(self):
        args, expected = self._captured_start_args('explicit.db')
        self.assertIn('--db', args)
        self.assertEqual(args[args.index('--db') + 1], str(expected))


class MissingDatabaseIsNeverCreated(unittest.TestCase):
    """Security finding on #10291: the taskboard binary's OpenAt() does
    MkdirAll + create-on-open, so passing `--db <path>` for a path that does
    not exist would silently mint an EMPTY board. Before --db was pinned this
    host raised `Taskboard database is missing`; that must remain the only
    outcome — no spawn, no file, no directory.
    """

    def test_start_refuses_before_spawning_and_creates_nothing(self):
        spawned = []

        def fake_run(args, **kwargs):
            spawned.append(args)
            return subprocess.CompletedProcess(args, 0)

        with tempfile.TemporaryDirectory() as tmp:
            # Both the file AND its parent are absent, so a MkdirAll-style
            # side effect is observable as well as a bare create-on-open.
            absent = Path(tmp) / 'never-created' / 'taskboard.db'
            env = dict(os.environ)
            env['TASKBOARD_DB'] = str(absent)
            with patch.object(runtime, 'binary', return_value='FAKE_TASKBOARD_BIN'), \
                 patch.object(runtime, 'api', side_effect=OSError('not running')), \
                 patch.object(runtime.subprocess, 'run', side_effect=fake_run), \
                 patch.dict(runtime.os.environ, env, clear=True):
                with self.assertRaisesRegex(RuntimeError, 'database is missing'):
                    runtime.ensure_running()
            self.assertEqual(spawned, [], 'the binary must not be spawned for a missing database')
            self.assertFalse(absent.exists(), 'no database file may be created')
            self.assertFalse(absent.parent.exists(), 'no database directory may be created')


class EmptyIdentitySetIsRefused(unittest.TestCase):
    """verify_database() compares the database's project ids with the API's.
    Two empty sets are equal, so a freshly created empty database "matched"
    an empty API answer and every downstream check passed vacuously
    (lessons-learned #11). An empty identity set is now a refusal, not a match.
    """

    def _database(self, tmp, project_ids):
        path = Path(tmp) / 'taskboard.db'
        conn = sqlite3.connect(path)
        try:
            conn.execute('CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT)')
            conn.executemany('INSERT INTO projects(id, name) VALUES(?, ?)', [(p, p) for p in project_ids])
            conn.commit()
        finally:
            conn.close()
        return path

    def test_empty_database_is_refused_even_when_the_api_agrees(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._database(tmp, [])
            with self.assertRaisesRegex(RuntimeError, 'no projects'):
                runtime.verify_database(path, projects=[])

    def test_populated_database_matching_the_api_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._database(tmp, ['p1'])
            self.assertEqual(runtime.verify_database(path, projects=[{'id': 'p1'}]), path)

    def test_populated_database_diverging_from_the_api_still_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._database(tmp, ['p1'])
            with self.assertRaisesRegex(RuntimeError, 'identity mismatch'):
                runtime.verify_database(path, projects=[{'id': 'p2'}])


class FirstRunInitIsTheOnlyCreator(unittest.TestCase):
    """start/mcp/sync refuse a missing database and an empty identity set, so
    a new machine needs ONE explicit way to get a board, or the documented
    "start, then pull" recipe can never succeed. `init` is that way, and it
    must refuse every state where creating or adopting could fork a board.
    """

    def _fake_binary(self, spawned, state):
        """A stand-in for `taskboard start --db <path>`: create-on-open with a
        minimal schema, after which the 'server' serves THAT file's projects."""

        real_run = subprocess.run

        def fake_run(args, **kwargs):
            if args[0] != 'FAKE_TASKBOARD_BIN':
                return real_run(args, **kwargs)  # repo_root()'s git call
            spawned.append(args)
            db = Path(args[args.index('--db') + 1])
            db.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(db)
            try:
                conn.execute('CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT, prefix TEXT, description TEXT)')
                conn.execute('CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY, project_id TEXT)')
                conn.commit()
            finally:
                conn.close()
            state['db'] = db
            return subprocess.CompletedProcess(args, 0)

        def fake_api(path):
            if 'db' not in state:
                raise OSError('not running')
            conn = sqlite3.connect(state['db'])
            try:
                return [{'id': row[0]} for row in conn.execute('SELECT id FROM projects')]
            finally:
                conn.close()

        return fake_run, fake_api

    def _run_init(self, env, state):
        spawned = []
        fake_run, fake_api = self._fake_binary(spawned, state)
        with patch.object(runtime, 'binary', return_value='FAKE_TASKBOARD_BIN'), \
             patch.object(runtime, 'api', side_effect=fake_api), \
             patch.object(runtime.subprocess, 'run', side_effect=fake_run), \
             patch.dict(runtime.os.environ, env, clear=True):
            try:
                return runtime.init_database(), spawned
            except RuntimeError as exc:
                return exc, spawned

    def test_init_creates_binds_and_verifies_on_a_new_machine(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / 'fresh' / 'taskboard.db'
            env = dict(os.environ)
            env['TASKBOARD_DB'] = str(db)
            result, spawned = self._run_init(env, {})
            self.assertNotIsInstance(result, RuntimeError, str(result))
            self.assertEqual(len(spawned), 1)
            self.assertEqual(spawned[0][spawned[0].index('--db') + 1], str(db.resolve()))
            conn = sqlite3.connect(db)
            try:
                bound = conn.execute('SELECT project_id FROM taskboard_repository_projects').fetchall()
                projects = conn.execute('SELECT id FROM projects').fetchall()
            finally:
                conn.close()
            self.assertEqual(len(bound), 1, 'init must bind this repository to exactly one project')
            self.assertEqual([p[0] for p in projects], [bound[0][0]])
            # The board init produced is one every other client accepts.
            self.assertEqual(runtime.verify_database(db, projects=[{'id': bound[0][0]}]), db)

    def test_init_refuses_a_populated_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / 'taskboard.db'
            conn = sqlite3.connect(db)
            try:
                conn.execute('CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT)')
                conn.execute("INSERT INTO projects VALUES('p1', 'existing')")
                conn.commit()
            finally:
                conn.close()
            env = dict(os.environ)
            env['TASKBOARD_DB'] = str(db)
            result, spawned = self._run_init(env, {})
            self.assertIsInstance(result, RuntimeError)
            self.assertIn('already exists', str(result))
            self.assertEqual(spawned, [], 'init must not start a server over a populated board')

    def test_init_refuses_while_a_server_is_already_running(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / 'never-created' / 'taskboard.db'
            env = dict(os.environ)
            env['TASKBOARD_DB'] = str(db)
            # A server answering on ANOTHER database: init cannot tell which.
            elsewhere = Path(tmp) / 'elsewhere.db'
            conn = sqlite3.connect(elsewhere)
            try:
                conn.execute('CREATE TABLE projects(id TEXT PRIMARY KEY)')
                conn.commit()
            finally:
                conn.close()
            result, spawned = self._run_init(env, {'db': elsewhere})
            self.assertIsInstance(result, RuntimeError)
            self.assertIn('already running', str(result))
            self.assertEqual(spawned, [])
            self.assertFalse(db.parent.exists(), 'no database directory may be created')


class McpCommandAlwaysPassesExplicitPath(unittest.TestCase):
    """The MCP server: `taskboard_runtime.py mcp` opens its own connection —
    it does not talk to the already-verified HTTP server — so it is the
    branch most exposed to silently diverging.
    """

    def _captured_mcp_args(self, taskboard_db=None):
        captured = {}

        def fake_call(args, **kwargs):
            captured['args'] = args
            return 0

        env = dict(os.environ)
        if taskboard_db is None:
            env.pop('TASKBOARD_DB', None)
        else:
            env['TASKBOARD_DB'] = taskboard_db

        with patch.object(sys, 'argv', ['taskboard_runtime.py', 'mcp']), \
             patch.object(runtime, 'binary', return_value='FAKE_TASKBOARD_BIN'), \
             patch.object(runtime, 'ensure_running', return_value=None), \
             patch.object(runtime.subprocess, 'call', side_effect=fake_call), \
             patch.dict(runtime.os.environ, env, clear=True):
            with self.assertRaises(SystemExit):
                runtime.main()
            expected = runtime.default_db()
        return captured['args'], expected

    def test_db_flag_present_without_taskboard_db_env(self):
        args, expected = self._captured_mcp_args(None)
        self.assertIn('--db', args, 'mcp command must always pin --db, not only when TASKBOARD_DB is set')
        self.assertEqual(args[args.index('--db') + 1], str(expected))

    def test_db_flag_present_with_taskboard_db_env(self):
        args, expected = self._captured_mcp_args(str(Path(tempfile.gettempdir()) / 'explicit-mcp.db'))
        self.assertIn('--db', args)
        self.assertEqual(args[args.index('--db') + 1], str(expected))


class SyncScriptDelegatesPathResolution(unittest.TestCase):
    """github_project_sync.py must resolve DB_PATH by calling
    taskboard_runtime.default_db() — never a local/legacy computation — so a
    real, separate process import is the only thing that can prove it.
    """

    def test_db_path_matches_default_db_via_taskboard_db_env(self):
        sentinel = str(Path(tempfile.gettempdir()) / 'sync-sentinel' / 'taskboard.db')
        # The literal comparison below must go through the SAME
        # expanduser().resolve() pipeline default_db() applies, not the raw
        # sentinel string. On some Windows hosts (observed on a GitHub-hosted
        # Windows runner, not reproducible on every machine) `Path.resolve()`
        # normalizes an ancestor directory's on-disk case or follows a
        # reparse point for a component of the temp path, so the resolved
        # value can legitimately differ from `tempfile.gettempdir()`'s raw,
        # unresolved string even though nothing is wrong. Resolving the
        # sentinel here — in the same process, against the same filesystem,
        # before it crosses into the subprocess — keeps the assertion's real
        # purpose intact: proving DB_PATH tracks the sentinel we set via
        # TASKBOARD_DB rather than silently falling back to the platform
        # default (which resolves under a completely different ancestor and
        # so could never match either form of the sentinel).
        resolved_sentinel = str(Path(sentinel).expanduser().resolve())
        script = (
            "import sys; sys.path.insert(0, r'" + str(HOOKS_DIR) + "')\n"
            "import taskboard_runtime as runtime\n"
            "import github_project_sync as sync\n"
            "expected = runtime.default_db()\n"
            "assert str(sync.DB_PATH) == str(expected), (sync.DB_PATH, expected)\n"
            "assert str(sync.DB_PATH) == r'" + resolved_sentinel + "', sync.DB_PATH\n"
            "print('MATCH')\n"
        )
        result = _run_py(script, {'TASKBOARD_DB': sentinel})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('MATCH', result.stdout)

    def test_db_path_matches_default_db_on_default_platform(self):
        # No override at all: still must be the SAME value default_db()
        # itself would produce for this real process/platform — not some
        # other client's independently-computed default.
        script = (
            "import sys; sys.path.insert(0, r'" + str(HOOKS_DIR) + "')\n"
            "import taskboard_runtime as runtime\n"
            "import github_project_sync as sync\n"
            "expected = runtime.default_db()\n"
            "assert str(sync.DB_PATH) == str(expected), (sync.DB_PATH, expected)\n"
            "print('MATCH')\n"
        )
        env = dict(os.environ)
        env.pop('TASKBOARD_DB', None)
        result = subprocess.run(
            [sys.executable, '-c', script],
            cwd=str(HOOKS_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('MATCH', result.stdout)


if __name__ == '__main__':
    unittest.main()
