# Taskboard Setup

Portable project management via [tcarac/taskboard](https://github.com/tcarac/taskboard).

## Quick Start

```bash
# 1. Get the taskboard binary (or build from source)
#    go install github.com/tcarac/taskboard@latest
#    Or download a release binary from GitHub

# 2. Start the server pointing at the DB in this repo
taskboard start --db .claude/taskboard.db

# 3. Open the web UI
#    http://localhost:3010
```

## What's in the DB

- **Project:** Project Forge (prefix: PF, ID: `01KJEE8R1XXFF0CZT1WCSTGRDP`)
- **Teams:**
  - Engineering: `01KJFNHZC49XG9KXRYTMYEEDTS`
  - PM: `01KJFNJC02QK6F5NSDND7NH5MS`
  - Leadership: `01KJFNK35JVPQJESS3RZM0F5HP`
- **Priorities:** urgent, high, medium, low

## Claude Code Integration

The taskboard is connected as an MCP server in Claude Code. The `kanban` skill
(`.claude/skills/kanban/SKILL.md`) enforces ticket-driven workflow.

### Hooks
- `on-session-start.sh` — Checks taskboard health on session start
- `on-prompt-submit.sh` — Reminds about taskboard-driven workflow
- `taskboard-state.sh` — Captures board state

### Settings
- `.claude/settings.json` — Hook configuration (project-level, no secrets)
- `.claude/settings.local.json` — Local/personal settings (gitignored)

## Portability

To use on another machine:
1. Clone the repo (DB is tracked in git)
2. Install the taskboard binary
3. Run `taskboard start --db .claude/taskboard.db`
4. Configure Claude Code's MCP server to point at `http://localhost:3010`

## Keeping the DB in Sync

The SQLite DB is committed to git. When updating tickets:
1. Make your changes via the API or UI
2. The DB file changes on disk
3. Commit the updated `taskboard.db` with your code changes
