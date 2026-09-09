#!/usr/bin/env python3
"""One portable taskboard runtime for HTTP, MCP and repository synchronization."""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request


def repo_root(start=None):
    start = Path(start or Path(__file__).parent)
    result = subprocess.run(['git', '-C', str(start), 'rev-parse', '--path-format=absolute', '--git-common-dir'], capture_output=True, text=True, check=True)
    return Path(result.stdout.strip()).parent


def default_db(platform=None, environ=None, home=None):
    platform = platform or sys.platform
    env = os.environ if environ is None else environ
    home = Path(home or Path.home())
    if env.get('TASKBOARD_DB'):
        return Path(env['TASKBOARD_DB']).expanduser().resolve()
    if platform == 'win32':
        # GUI hosts may omit APPDATA. Restore the normal Windows config root
        # rather than starting a second board under Go's ~/.config fallback.
        config = Path(env.get('APPDATA') or home / 'AppData' / 'Roaming')
    elif platform == 'darwin':
        config = home / 'Library' / 'Application Support'
    else:
        config = Path(env.get('XDG_CONFIG_HOME') or home / '.config')
    return config / 'taskboard' / 'taskboard.db'


def runtime_env():
    env = dict(os.environ)
    if sys.platform == 'win32' and not env.get('APPDATA'):
        env['APPDATA'] = str(Path.home() / 'AppData' / 'Roaming')
    return env


def api(path):
    base = os.environ.get('TASKBOARD_API', 'http://localhost:3010/api').rstrip('/')
    with urllib.request.urlopen(base + path, timeout=5) as response:
        return json.load(response)


def verify_database(path, projects=None):
    """Read-only preflight: never create/migrate a different or corrupt DB."""
    path = Path(path)
    if not path.is_file():
        raise RuntimeError('Taskboard database is missing: ' + str(path))
    conn = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        if conn.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise RuntimeError('Taskboard database integrity check failed; restore a backup before sync')
        actual = {row[0] for row in conn.execute('SELECT id FROM projects')}
        expected = {p['id'] for p in (api('/projects') if projects is None else projects)}
        if actual != expected:
            raise RuntimeError('Taskboard API/database identity mismatch; restart all clients through taskboard_runtime.py')
    finally:
        conn.close()
    return path


def binary():
    root = repo_root()
    candidates = [os.environ.get('TASKBOARD_BIN'), shutil.which('taskboard'),
                  root.parent / 'taskboard' / ('taskboard.exe' if sys.platform == 'win32' else 'taskboard'),
                  Path.home() / 'go' / 'bin' / ('taskboard.exe' if sys.platform == 'win32' else 'taskboard'),
                  Path.home() / '.local' / 'bin' / 'taskboard']
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(candidate)
    raise RuntimeError('Install tcarac/taskboard on PATH or set TASKBOARD_BIN')


def ensure_running():
    try:
        projects = api('/projects')
    except (OSError, ValueError):
        args = [binary(), 'start', '--port', '3010']
        if os.environ.get('TASKBOARD_DB'):
            args += ['--db', str(default_db())]
        subprocess.run(args, env=runtime_env(), check=True, stdout=sys.stderr)
        for _ in range(20):
            try:
                projects = api('/projects')
                break
            except (OSError, ValueError):
                time.sleep(0.25)
        else:
            raise RuntimeError('Taskboard did not become available')
    verify_database(default_db(), projects)


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else 'doctor'
    if command == 'db-path':
        print(default_db())
        return
    ensure_running()
    if command == 'mcp':
        args = [binary(), 'mcp']
        if os.environ.get('TASKBOARD_DB'):
            args += ['--db', str(default_db())]
        raise SystemExit(subprocess.call(args, env=runtime_env()))
    if command == 'identity':
        import taskboard_sync
        config = json.loads((repo_root() / '.claude/hooks/github-sync-config.json').read_text())
        with taskboard_sync.connect(default_db()) as conn:
            project = taskboard_sync.bind_project(conn, config)
            team = conn.execute('SELECT id FROM teams ORDER BY name LIMIT 1').fetchone()
        print(json.dumps({'projectId': project, 'teamId': team[0] if team else '', 'database': str(default_db())}))
    elif command in ('doctor', 'start'):
        print(json.dumps({'database': str(default_db()), 'integrity': 'ok', 'apiIdentity': 'matched'}))
    else:
        raise RuntimeError('Expected start, mcp, identity, doctor or db-path')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as exc:
        print('[taskboard] ' + str(exc), file=sys.stderr)
        sys.exit(1)
