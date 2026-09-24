# Portable taskboard and GitHub sync

Start from the repository with Node, Python 3, Git, authenticated GitHub CLI, and tcarac/taskboard installed:

~~~sh
node .claude/hooks/taskboard-launch.mjs start
python3 .claude/hooks/github_project_sync.py pull
~~~

On Windows use python when python3 is unavailable. The launcher detects either spelling; PYTHON can explicitly select an interpreter. TASKBOARD_BIN selects an installed binary when it is not on PATH. Worktrees resolve the main checkout through git's common directory, not a hard-coded directory name.

HTTP, MCP and synchronization use the same runtime. Windows uses APPDATA/taskboard (restoring the standard Roaming path when a GUI host omits APPDATA); macOS uses Library/Application Support/taskboard; Linux uses XDG_CONFIG_HOME/taskboard or ~/.config/taskboard. TASKBOARD_DB is an explicit override that must be shared by every client. TASKBOARD_API defaults to http://localhost:3010/api. A mismatched API/database or failed integrity check stops synchronization before writes.

The MCP server needs no setup of your own. The committed `.mcp.json` (Claude Code) and `.codex/config.toml` (Codex, which does not read `.mcp.json`) declare the same `taskboard` server, and both start the launcher through a git alias:

~~~toml
[mcp_servers.taskboard]
command = "git"
args = ["-c", "alias.spawnforge-taskboard=!node .claude/hooks/taskboard-launch.mjs", "spawnforge-taskboard", "mcp"]
~~~

git runs a `!` alias from the top-level directory of the repository it was started in (git-config(1), `alias.*`), so the relative launcher path resolves wherever in the checkout the session started: the root, a subdirectory such as `web/`, or a linked worktree, which gets its own copy of the launcher. A bare `node .claude/hooks/taskboard-launch.mjs` does not. A client starts a stdio server in the directory the session started in, so from `web/` node looks for `web/.claude/hooks/taskboard-launch.mjs` and the server fails its handshake. A relative `cwd` does not help, because Codex resolves it against that same start directory. `scripts/check-codex-port.sh` fails a server launched either way, and `scripts/__tests__/check-codex-port.test.sh` runs the committed command from a subdirectory.

If an earlier version of this guide had you add a `[mcp_servers.taskboard]` block with an absolute path to your user-level `~/.codex/config.toml` (`%USERPROFILE%\.codex\config.toml` on Windows), remove it: a user-level server is started for every project you open. Do not add a second `[mcp_servers.taskboard]` table to the repository's `.codex/config.toml` either. A table defined twice is a TOML error, and Codex then refuses to load the configuration at all ("duplicate key").

Observed with codex-cli 0.144.1 on Windows 11 on 2026-09-23, through `codex app-server` with an ephemeral thread and no model turn. Started in `web/src`, the committed entry reached `ready` and listed the board's 21 tools. The old `node .claude/hooks/taskboard-launch.mjs` entry failed its handshake from the same directory. Not observed: a logged-in Codex session calling a taskboard tool, or Claude Code starting the `.mcp.json` entry.

Remove old client overrides pointing at .claude/taskboard.db. Reconnect already-running MCP sessions after changing their configuration. Never copy a SQLite database into a worktree or delete a database to resolve an identity mismatch.

## Identity and non-duplication

Each machine binds owner/repository to one local project in taskboard_repository_projects. Local project/team IDs are rediscovered; IDs embedded by another developer's machine cannot redirect imports. Existing sync_repo remains the repository name, github_issue_number the issue number, and sync_owner adds owner isolation. A unique index enforces owner/repository/issue identity. Unrelated projects remain in the shared local database.

Pull imports open repository issues and refreshes already-linked closed issues. It does not populate every closed historical issue on a new machine. Titles are editable content and never identity. Ticket insertion, the remote link and the sync baseline commit atomically. JSON map files are legacy caches and do not control the new push/pull engine. Conflicting local/remote edits are reported and preserved instead of selecting a silent winner.

A new local ticket in a bound project may create a GitHub issue. The database records its unique creation intent before POST. If the request's outcome is uncertain, subsequent sync searches the exact marker across repository issues. It adopts exactly one matching issue; if none or several are found, creation stays blocked and no second POST is sent. Resolve such cases by verifying the remote issue and binding its explicit owner/repository/number, never by matching a title or deleting the intent to force a retry. Existing unlinked tickets at initial bootstrap stay local until their identity is explicitly reconciled.

GitHub Project attachment/status failures are queued separately from issue creation. They cannot cause another issue to be created. Subtasks and priority travel in a bounded metadata block; descriptions remain intact. Repeated unchanged pulls/pushes perform no issue mutation. Synchronization is serialized across clones/worktrees using a repository lock next to the shared database and has a cooperative wall-clock budget.

The old title-based dedup and close-orphans commands now refuse to run. Session-start reconcile-apply pulls remote state; it cannot close issues based on a stale local status.

## Recovery

Stop conflicting clients, back up each database with SQLite's backup API, and inspect integrity and repository bindings before migration. Preserve unrelated projects and unlinked local work. Do not overwrite or delete a corrupt legacy file before its readable records have been inventoried. Run the launcher doctor, pull twice, then push and verify no duplicate identities or unexpected remote mutations.

~~~sh
node .claude/hooks/taskboard-launch.mjs doctor
python3 -m unittest discover -s .claude/hooks/__tests__ -p taskboard_sync_test.py
bash .claude/hooks/__tests__/github_project_sync.test.sh
~~~
