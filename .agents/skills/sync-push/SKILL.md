---
name: sync-push
description: "Push local taskboard ticket changes to GitHub Project board. Creates draft issues for new tickets and updates status for changed tickets. Use when you need to manually sync outbound changes."
argument-hint: "Optional: --all to include done tickets"
user-invokable: true
---

# /sync-push — Push Local Taskboard to GitHub Project

Push local taskboard ticket changes to the GitHub Project board (SpawnForge #2).

## Commands

```bash
# Incremental push (todo + in_progress + newly done)
cd project-forge && python3 .claude/hooks/github_project_sync.py push

# Full push (all tickets including done)
cd project-forge && python3 .claude/hooks/github_project_sync.py push-all

# Check sync status
cd project-forge && python3 .claude/hooks/github_project_sync.py status
```

## V2 Body Format

Push now syncs **full ticket content** to GitHub (not just status):
- **Body**: Description, priority, team, subtasks as `- [ ]`/`- [x]` checkboxes
- **Metadata block**: Hidden `<!-- SPAWNFORGE_METADATA -->` comment with ticketId, hashes, version
- **Change detection**: Only updates GitHub when bodyHash or subtaskHash changes
- **Format upgrade**: Old v1 tickets (`**Taskboard:** PF-N (ULID)`) auto-upgrade to v2 on next change
- **Rate limit guard**: If >10 tickets need format upgrade in incremental push, defers to `push-all`

## When to Use

- After bulk ticket operations (creating many tickets, reorganizing board)
- To verify sync state after network issues
- When `--all` is needed to backfill historical tickets to GitHub
- To bulk-upgrade all tickets to v2 body format (`push-all`)

## Automatic Sync

This runs automatically via the Stop hook after every response. Manual invocation is only needed for bulk operations or troubleshooting.

## Prerequisites

- `gh` CLI authenticated
- Taskboard API running on port 3010
- Python 3 available
