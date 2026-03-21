# /sync-push — Push Local Taskboard to GitHub Project

Push local taskboard ticket changes to the GitHub Project board (SpawnForge #2).

## What It Does

1. Reads all local tickets from the taskboard API (localhost:3010)
2. Compares each ticket's status with the last-synced status in the mapping file
3. Creates new draft items on GitHub for untracked tickets
4. Updates status on GitHub for tickets whose status changed locally
5. Saves the updated mapping to `.claude/hooks/github-project-map.json`

## Behavior

- **Default (`/sync-push`)**: Only syncs `todo` and `in_progress` tickets, plus tickets that just moved to `done`
- **Full (`/sync-push --all`)**: Syncs ALL tickets including historical `done` tickets

## Commands

```bash
# Incremental push (default — what hooks do automatically)
cd project-forge && python3 .claude/hooks/github_project_sync.py push

# Full push (all tickets including done)
cd project-forge && python3 .claude/hooks/github_project_sync.py push-all

# Check sync status
cd project-forge && python3 .claude/hooks/github_project_sync.py status
```

## When to Use

- After bulk ticket operations (creating many tickets, reorganizing board)
- To verify sync state after network issues
- When `--all` is needed to backfill historical tickets to GitHub

## Automatic Sync

This runs automatically via the **Stop hook** after every Claude response. You typically don't need to invoke it manually unless doing bulk operations or troubleshooting.

## MANDATORY: Run Before Creating Any PR

Every PR must link to a GitHub issue (`Closes #NNNN`). Tickets only become GitHub issues after sync-push runs. If you skip this step, the CI work item check will **fail**.

```bash
# 1. Sync tickets to GitHub
python3 .claude/hooks/github_project_sync.py push

# 2. Find the GitHub issue number for your ticket
gh issue list --search "PF-XXX in:title" --limit 1

# 3. Use the issue number in your PR body
# Closes #NNNN
```

## Configuration

- Config: `.claude/hooks/github-sync-config.json` (project IDs, field mappings)
- Mapping: `.claude/hooks/github-project-map.json` (ticket ↔ GitHub item ID mapping)

## Prerequisites

- `gh` CLI authenticated (`gh auth status`)
- Taskboard API running (`taskboard start --port 3010`)
- GitHub Project "SpawnForge" (#2) exists with Todo/In Progress/Done columns

## DB Path Resolution

The sync script auto-detects the taskboard SQLite DB:
1. `TASKBOARD_DB` env var (explicit override)
2. OS default: `~/Library/Application Support/taskboard/taskboard.db` (macOS) or `~/.local/share/taskboard/taskboard.db` (Linux)
3. Legacy fallback: `.claude/taskboard.db`

Do NOT pass `--db .claude/taskboard.db` to `taskboard start` — let it use its default path.
