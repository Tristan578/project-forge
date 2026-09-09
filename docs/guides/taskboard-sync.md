# Portable taskboard and GitHub sync

Start from the repository with Node, Python 3, Git, authenticated GitHub CLI, and tcarac/taskboard installed:

~~~sh
node .claude/hooks/taskboard-launch.mjs start
python3 .claude/hooks/github_project_sync.py pull
~~~

On Windows use python when python3 is unavailable. The launcher detects either spelling; PYTHON can explicitly select an interpreter. TASKBOARD_BIN selects an installed binary when it is not on PATH. Worktrees resolve the main checkout through git's common directory, not a hard-coded directory name.

HTTP, MCP and synchronization use the same runtime. Windows uses APPDATA/taskboard (restoring the standard Roaming path when a GUI host omits APPDATA); macOS uses Library/Application Support/taskboard; Linux uses XDG_CONFIG_HOME/taskboard or ~/.config/taskboard. TASKBOARD_DB is an explicit override that must be shared by every client. TASKBOARD_API defaults to http://localhost:3010/api. A mismatched API/database or failed integrity check stops synchronization before writes.

The committed .mcp.json config runs the launcher. For Codex add this project-local block, preserving other configuration:

~~~toml
[mcp_servers.taskboard]
command = "node"
args = [".claude/hooks/taskboard-launch.mjs", "mcp"]
~~~

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
