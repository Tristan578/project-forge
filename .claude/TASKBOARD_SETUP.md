# Taskboard Setup

Portable project management via [tcarac/taskboard](https://github.com/tcarac/taskboard).

## Quick Start

```bash
# 1. Get the taskboard binary (or build from source)
#    go install github.com/tcarac/taskboard@latest
#    Or download a release binary from GitHub

# 2. Start the server (uses OS default DB — do NOT pass --db flag)
taskboard start --port 3010

# 3. Open the web UI
#    http://localhost:3010

# 4. Sync tickets from GitHub Project
python3 .claude/hooks/github_project_sync.py pull
```

**IMPORTANT:** Do NOT pass `--db .claude/taskboard.db`. The OS default path (`~/Library/Application Support/taskboard/`) is the source of truth. Passing `--db` creates an empty local copy that causes agents to see 0 tickets.

## What's in the DB

- **Project:** Project Forge (prefix: PF, ID: `01KK974VMNC16ZAW7MW1NH3T3M`)
- **Teams:**
  - Engineering: `01KK9751NZ4HM7VQM0AQ5WGME3`
  - PM: `01KK9751P7GKQYG9TZ96XXQCFN`
  - Leadership: `01KK9751PD79RCWY462CYQ06CW`
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
3. Run `taskboard start --port 3010` (no --db flag)
4. Run `python3 .claude/hooks/github_project_sync.py pull` to populate from GitHub
