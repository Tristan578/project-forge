---
name: sync-push
description: "Push local taskboard ticket changes to GitHub Project board. Syncs full ticket content including description, subtasks, priority, and metadata."
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

Push syncs **full ticket content** to GitHub (not just status):
- **Body**: Description, priority, team, subtasks as `- [ ]`/`- [x]` checkboxes
- **Metadata block**: Hidden `<!-- SPAWNFORGE_METADATA -->` comment with ticketId, hashes, version
- **Change detection**: Only updates GitHub when bodyHash or subtaskHash changes
- **Format upgrade**: Old v1 tickets auto-upgrade to v2 on next change
- **Rate limit guard**: If >10 tickets need format upgrade in incremental push, defers to `push-all`

## When to Use

- After bulk ticket operations (creating many tickets, reorganizing board)
- To verify sync state after network issues
- To bulk-upgrade all tickets to v2 body format (`push-all`)

## Prerequisites

- `gh` CLI authenticated
- Taskboard API running on port 3010
- Python 3 available
