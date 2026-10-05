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
        # rather than starting a second board under the binary's ~/.config
        # fallback (see ensure_running() for where that fallback comes from).
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


# How to stop a running server, for messages that ask the operator to.
# `taskboard stop` is the binary's own subcommand (present in tcarac/taskboard
# v0.6.0, which finds the server through a pid file in its config directory);
# pkill / Task Manager is the fallback when that does not find it.
STOP_HINT = 'stop the running server with `taskboard stop` (or `pkill taskboard`; on Windows end taskboard.exe in Task Manager)'


def require_database(path):
    """The shared database must already exist; nothing here may create one.

    Assumed about the external binary, not enforced by anything here: it
    creates a missing `--db` path on open. That is what tcarac/taskboard
    v0.6.0 does (internal/db/db.go OpenAt: os.MkdirAll on the directory, then
    sql.Open + migrations, which creates the file), but the binary a host has
    installed may be another version. The guard is correct either way: it
    refuses BEFORE the spawn, so it never depends on what the binary would
    have done. If the binary does create on open, handing it `--db <path>`
    for a path that does not exist would silently mint an EMPTY database.
    That empty board then reads as "0 tickets", and the
    session-start hook's remedy for 0 tickets is a GitHub pull — which
    github_project_sync.py's header names as a duplicate-issue hazard.
    Checked BEFORE the binary is spawned, so the only outcome on a host with
    no database is this error, never a new file. A genuinely new machine
    creates its board with the explicit `init` command (init_database).
    """
    path = Path(path)
    if not path.is_file():
        raise RuntimeError('Taskboard database is missing: ' + str(path) + '. On a new machine run `node .claude/hooks/taskboard-launch.mjs init` once; if your board lives elsewhere, set TASKBOARD_DB to it')
    return path


def verify_database(path, projects=None):
    """Read-only preflight: never create/migrate a different or corrupt DB."""
    path = require_database(path)
    conn = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        if conn.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise RuntimeError('Taskboard database integrity check failed; restore a backup before sync')
        actual = {row[0] for row in conn.execute('SELECT id FROM projects')}
        if not actual:
            # An empty identity set matches an empty API answer, so the
            # comparison below would pass vacuously — exactly what a freshly
            # created empty database produces (lessons-learned #11). Refuse it.
            raise RuntimeError('Taskboard database has no projects; refusing to treat an empty identity set as a match. Restore the shared database, or ' + STOP_HINT + ', then run `node .claude/hooks/taskboard-launch.mjs init` to bind this repository (#9995)')
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
        # Always pass the resolved path explicitly, never conditionally on
        # TASKBOARD_DB being set. Without --db the binary picks its own
        # default. In tcarac/taskboard v0.6.0 (internal/db/db.go
        # DefaultDBPath) that is os.UserConfigDir()/taskboard/taskboard.db,
        # and when os.UserConfigDir() returns an error (on Windows it does
        # when %AppData% is empty) the binary itself falls back to
        # ~/.config/taskboard/taskboard.db, which is not where default_db()
        # looks. Other versions may differ; that is an assumption about an
        # external binary, and this code does not depend on it: passing
        # --db unconditionally makes default_db() the ONLY path the server
        # can open, whatever the binary's own default is, closing the
        # divergence #9995 reported.
        #
        # The file must exist BEFORE the spawn: the binary may create a
        # missing --db path on open (see require_database), and an empty
        # board is the one state every downstream check would wave through.
        projects = _spawn_server(require_database(default_db()))
    verify_database(default_db(), projects)


def _spawn_server(db):
    args = [binary(), 'start', '--port', '3010', '--db', str(db)]
    subprocess.run(args, env=runtime_env(), check=True, stdout=sys.stderr)
    for _ in range(20):
        try:
            return api('/projects')
        except (OSError, ValueError):
            time.sleep(0.25)
    raise RuntimeError('Taskboard did not become available')


def _project_count(db):
    # connect() is inside the try: a path sqlite cannot open at all (a
    # directory, say) raises from connect itself, and that must surface as
    # the same clear refusal rather than a raw sqlite3 traceback.
    conn = None
    try:
        conn = sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True)
        return conn.execute('SELECT COUNT(*) FROM projects').fetchone()[0]
    except sqlite3.Error as exc:
        raise RuntimeError('Not a taskboard database: ' + str(db) + ' (' + str(exc) + '). Point TASKBOARD_DB at the shared database, or move this path aside and re-run init') from exc
    finally:
        if conn is not None:
            conn.close()


def init_database():
    """First-run bootstrap: the ONLY path allowed to create the shared database.

    start/mcp/sync refuse a missing file (require_database) and an empty
    identity set (verify_database), so without this a new machine has no way
    to get a board at all — the documented "start, then pull" recipe would
    fail at its first step. init is explicit and refuses every state in which
    creating or adopting could hide or fork an existing board:
      - a database at default_db() that already holds a project;
      - a server already answering, which is open on SOME database (possibly
        another one) and would be mistaken for this one.
    It then starts the binary on default_db() (tcarac/taskboard v0.6.0
    creates the file and its schema on open; whatever another version does,
    the verify below is what proves the result), binds
    this repository's project so the identity set is non-empty, and runs the
    normal verify_database() so the API is proven to serve this exact file.
    """
    db = default_db()
    if db.exists() and _project_count(db):
        raise RuntimeError('Taskboard database already exists and is populated: ' + str(db) + '; init is only for a new machine. Use `node .claude/hooks/taskboard-launch.mjs start`')
    try:
        api('/projects')
    except (OSError, ValueError):
        pass
    else:
        raise RuntimeError('A taskboard server is already running, so init cannot tell which database it serves. ' + STOP_HINT[0].upper() + STOP_HINT[1:] + ', then re-run init; it will start one on ' + str(db))
    _spawn_server(db)
    import taskboard_sync
    config = json.loads((repo_root() / '.claude/hooks/github-sync-config.json').read_text())
    with taskboard_sync.connect(db) as conn:
        taskboard_sync.bind_project(conn, config)
    return verify_database(db)


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else 'doctor'
    if command == 'db-path':
        print(default_db())
        return
    if command == 'init':
        db = init_database()
        print(json.dumps({'database': str(db), 'integrity': 'ok', 'apiIdentity': 'matched'}))
        # stdout stays machine-readable JSON; the next step goes to stderr.
        print('[taskboard] Initialised ' + str(db) + ' and bound this repository. Next step: run python3 .claude/hooks/github_project_sync.py pull'
              ' (use python on Windows if python3 is not on PATH) to fill the board from GitHub.', file=sys.stderr)
        return
    ensure_running()
    if command == 'mcp':
        # Same rule as ensure_running(): --db is unconditional. The MCP
        # subcommand opens its OWN database connection rather than talking
        # to the already-verified HTTP server, so without an explicit path
        # it can silently diverge from what ensure_running() just verified.
        args = [binary(), 'mcp', '--db', str(default_db())]
        raise SystemExit(subprocess.call(args, env=runtime_env()))
    if command == 'identity':
        import taskboard_sync
        config = json.loads((repo_root() / '.claude/hooks/github-sync-config.json').read_text())
        with taskboard_sync.connect(default_db()) as conn:
            project = taskboard_sync.bind_project(conn, config)
            with conn:
                team = taskboard_sync.resolve_team(conn, config)
        print(json.dumps({'projectId': project, 'teamId': team, 'database': str(default_db())}))
    elif command in ('doctor', 'start'):
        print(json.dumps({'database': str(default_db()), 'integrity': 'ok', 'apiIdentity': 'matched'}))
    else:
        raise RuntimeError('Expected init, start, mcp, identity, doctor or db-path')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError, sqlite3.Error) as exc:
        print('[taskboard] ' + str(exc), file=sys.stderr)
        sys.exit(1)
