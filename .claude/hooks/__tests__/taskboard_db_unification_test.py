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
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HOOKS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HOOKS_DIR))
import taskboard_runtime as runtime  # noqa: E402


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

        # Only override TASKBOARD_DB; keep the REAL environment (HOME/
        # APPDATA/etc.) intact so default_db()'s platform logic runs for
        # real, exactly as it would for a real client. Compute the expected
        # path from this SAME env dict, inside the patched context, rather
        # than calling default_db() again afterwards against the restored
        # (unpatched) os.environ — the two would silently disagree whenever
        # taskboard_db is set, defeating the assertion.
        env = dict(os.environ)
        if taskboard_db is None:
            env.pop('TASKBOARD_DB', None)
        else:
            env['TASKBOARD_DB'] = taskboard_db

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
        args, expected = self._captured_start_args(str(Path(tempfile.gettempdir()) / 'explicit.db'))
        self.assertIn('--db', args)
        self.assertEqual(args[args.index('--db') + 1], str(expected))


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
