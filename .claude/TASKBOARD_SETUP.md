# Taskboard Setup

Portable project management via [tcarac/taskboard](https://github.com/tcarac/taskboard).

## Quick Start

```bash
# 1. Get the taskboard binary. `go install github.com/tcarac/taskboard@latest`
#    does NOT work (v0.6.0 has no main package at the module root, and
#    cmd/taskboard embeds a web/dist the module does not ship). Use one of:
#      brew tap tcarac/taskboard && brew install taskboard
#      a release binary from https://github.com/tcarac/taskboard/releases
#      git clone https://github.com/tcarac/taskboard && cd taskboard && make build
#    Not on PATH? Set TASKBOARD_BIN to the binary.

# 2a. FIRST run on a new machine only (no taskboard database yet): init creates
#     the shared database and binds this repository's project. Run it once,
#     instead of start.
node .claude/hooks/taskboard-launch.mjs init

# 2b. Every time after that: start the server through the launcher. It
#     resolves the ONE shared DB path and passes it to the binary itself
#     (never start the binary by hand).
node .claude/hooks/taskboard-launch.mjs start

# 3. Open the web UI
#    http://localhost:3010

# 4. Sync tickets from GitHub Project
python3 .claude/hooks/github_project_sync.py pull
```

**IMPORTANT:** Never start the binary by hand and never pass your own `--db` — least of all `--db .claude/taskboard.db`, which creates an empty local copy and makes agents see 0 tickets. The launcher (`taskboard-launch.mjs` → `taskboard_runtime.py`) resolves the shared path — `TASKBOARD_DB` if set, else the OS config directory: `%APPDATA%\taskboard\taskboard.db` on Windows, `~/Library/Application Support/taskboard/taskboard.db` on macOS, `$XDG_CONFIG_HOME/taskboard/taskboard.db` on Linux — and passes it explicitly, so the HTTP server, the MCP server and `github_project_sync.py` all open the same file (#9995). It refuses to start when that file does not exist rather than creating an empty one; on a new machine, `node .claude/hooks/taskboard-launch.mjs init` creates it once, binds this repository's project, and refuses if a populated database already exists or a server is already running.

## What's in the DB

- **Project:** Project Forge (prefix: PF, ID: `01KMM9ZA6SBZ7RKJZJTZS9VR4R`)
- **Teams:**
  - Engineering: `01KMR5E36TP59PRQA8GQEWJVM1`
  - PM: `01KMR5E3852BWXAZ219W47CSKS`
- **Priorities:** urgent, high, medium, low
- **Source of truth:** GitHub Project #2 (SpawnForge), synced via `github_project_sync.py`

## Claude Code Integration

The taskboard is accessed via REST API at `http://localhost:3010/api`.
The `kanban` skill (`.claude/skills/kanban/SKILL.md`) enforces ticket-driven workflow.

### Hooks
- `on-session-start.sh` — Auto-starts taskboard, syncs from GitHub, displays board state, warns if 0 tickets
- `on-prompt-submit.sh` — Checks for active ticket before dev work, warns if board is empty
- `taskboard-state.sh` — Library for board queries, used by other hooks

## Portability

To use on another machine:
1. Clone the repo
2. Install the taskboard binary
3. Run `node .claude/hooks/taskboard-launch.mjs init` once (creates the shared database at the resolved path; afterwards always `start`, never the binary by hand)
4. Run `python3 .claude/hooks/github_project_sync.py pull` to populate from GitHub
